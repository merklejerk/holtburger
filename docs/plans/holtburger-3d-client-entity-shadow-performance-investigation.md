# Holtburger 3D Entity-Heavy Client Performance Investigation

Status: **Phase 6 material-independent depth-range cutover and Phase 7 diagnostic cleanup are
complete (2026-08-30). The structural target passed; final acceptance remains open because the
full-PSSM performance target is unmet.**

This worksheet records evidence from the local ACE client-mode scene where a mob-heavy outdoor
population reduces presentation to approximately 29 FPS. It is both the evidence worksheet and the
implementation log: decisions, rejected branches, concessions, and remaining debt are updated as
each gated phase lands.

## Context and Boundaries

### Goal

Identify which client-mode subsystems cause the entity-heavy scene to miss the 60 Hz frame budget
and cap near 60 FPS after PSSM is removed, then preserve enough workload and code-path evidence to
evaluate maintainable corrections.

### Guardrails

- Use the local ACE server at its default address and the test credentials supplied through
  `apps/holtburger-3d/.dev.env`.
- Keep credentials environment-only and out of logs and durable artifacts.
- Do not teleport, drive, or otherwise move the user-positioned character. The live sidecar probe
  ran in `passive` mode, which rejects teleport commands and movement replacement.
- Use the non-interactive Electron client probe for page, frame, and input evidence. Do not run the
  TUI client.
- Treat the checked-in renderer profile and the native V8 sample as attribution tools, not as
  interchangeable measurements.
- Preserve the boundary between authoritative entity state, shared presentation, renderer policy,
  and client-local quality choices.

### Repository state

The worktree already contained user-owned changes in `ACE/` and
`apps/holtburger-3d/package-lock.json`. This work has not modified either path. The release client
sidecar is built by the live UI probe; build output is ignored. Phase 7 restored that probe and the
client debug panel to their pre-investigation responsibilities. Durable renderer profiling and
shadow-policy controls remain in the Explorer and browser harness; focused deterministic renderer
fixtures remain with the production invariants they verify.

## Discarded Capture

The first account supplied in `.dev.env` selected a different character in a 27-entity scene. Its
measurements are invalid for this issue and must not be mixed with the corrected workload. The user
updated `.dev.env`, after which every result below selected the intended character at the same
outdoor location.

## Reproduction

### Authoritative and IPC census

A release-sidecar passive observation ran for 15 seconds after ordinary world entry.

| Fact                         |      Corrected scene |
| ---------------------------- | -------------------: |
| Unique entity GUIDs observed |                  118 |
| Largest complete snapshot    |         118 entities |
| Largest tick/update batch    |          95 entities |
| Dynamic-entity events        |                  736 |
| Camera events                |                  501 |
| All observed event frames    |                1,251 |
| Dynamic-entity payload bytes |            1,554,934 |
| All event-frame bytes        |            2,153,036 |
| Largest event frame          |        123,250 bytes |
| p95 event-frame size         |          2,483 bytes |
| Local-player travel          | 0.000123 world units |

The observation requested no drive or teleport work. The sub-millimetre local-player displacement
is consistent with reconciliation noise rather than user motion.

Interpretation: the scene has meaningful event pressure—approximately 49 dynamic events per
observation second—but most event frames are small. Event bandwidth alone does not explain the
observed binary drop to every-other-refresh rendering. The no-shadow A/B below preserves the same
authority and IPC behavior while substantially restoring frame rate.

### Unprofiled Electron baseline

The release Electron client used a `1442 × 902` CSS and drawing-buffer viewport at render scale 1.
The non-interactive probe entered the world, allowed the camera to settle, then sent a bounded
pointer gesture.

| Metric                           |      Shadow-map default |
| -------------------------------- | ----------------------: |
| Client FPS display               | 29 capped / 29 uncapped |
| Animation-frame interval p50     |                 33.3 ms |
| Animation-frame interval p95     |                 33.4 ms |
| Animation-frame interval maximum |                 83.4 ms |
| Camera-event interval p50        |                 29.6 ms |
| Camera-event interval p95        |                 51.0 ms |
| Input-to-camera latency p50      |                 29.3 ms |
| Input-to-camera latency p95      |                 32.1 ms |

The equal capped and uncapped rates establish that the scene is limited by work performed for each
frame rather than the 60 Hz presentation cap. The 33.3 ms median shows that the page commonly misses
one complete 60 Hz slot.

### Renderer draw census

The client debug panel was sampled after the same world entry and before the native CPU window.

| Draw fact                   | Value |
| --------------------------- | ----: |
| Views                       |     1 |
| Scene entries               |   116 |
| Visible static nodes        |     9 |
| Visible dynamic entities    |    44 |
| Visible dynamic rigid parts | 2,684 |
| Object draws                | 1,035 |
| Dynamic draws               |   855 |
| Particle batches            |     6 |

The important distribution is parts per entity, not entity count by itself: 44 visible entities
produce 2,684 rigid parts, or approximately 61 parts per visible entity. Shadow caster work operates
on those expanded rigid parts.

## Native CPU Profile

A 100-microsecond V8 sampling profile covered 8.115 seconds of the same steady scene. Profiling
overhead reduced the displayed result slightly to 28 FPS, so the unprofiled run above remains the
frame-rate baseline. The following are self times, not inclusive times.

| Function                        | Self time |
| ------------------------------- | --------: |
| `formOutdoorPssmCasterRuns`     |  690.3 ms |
| `formGroupedObjectInstanceRuns` |  438.7 ms |
| `transformAABB3`                |  383.2 ms |
| `collectOutdoorPssmCasters`     |  332.0 ms |
| `encodeObjectInstancesInto`     |  268.3 ms |
| Garbage collector               |  701.6 ms |
| `multiplyMat4` (largest site)   |  130.7 ms |
| `#resolveSceneContributions`    |   91.1 ms |
| `#drawObjectRange`              |   89.0 ms |

Other individually visible costs included caster batch-key construction, instance-buffer attribute
binding, dynamic-contribution resolution, scene-graph placement resolution, and additional matrix
work. The two shadow-specific functions alone account for approximately 1.02 seconds of sampled
self CPU. Generic grouping, transform, encoding, and garbage-collection costs are shared with other
renderer work, but the current shadow path invokes them repeatedly and appears prominently in the
same profile.

## Controlled Shadow A/B

The only source-level behavior change in the control was a temporary client composition override
from the shared `shadow-maps` entity-shadow mode to `none`. Authority, scene interest, content,
viewport, render scale, character position, and visible draw census were unchanged. The override was
removed immediately after the run.

| Metric                           | Default shadow maps |        Simple grounding |        Shadows disabled |
| -------------------------------- | ------------------: | ----------------------: | ----------------------: |
| Client FPS display               |             29 / 29 | 55 capped / 57 uncapped | 54 capped / 59 uncapped |
| Animation-frame interval p50     |             33.3 ms |                 16.7 ms |                 16.7 ms |
| Animation-frame interval p95     |             33.4 ms |                 16.8 ms |                 16.8 ms |
| Animation-frame interval maximum |             83.4 ms |                 50.0 ms |                 50.0 ms |
| Visible dynamic entities         |                  44 |             not sampled |                      45 |
| Visible dynamic parts            |               2,684 |             not sampled |                   2,686 |
| Object draws                     |               1,035 |             not sampled |                   1,035 |
| Dynamic draws                    |                 855 |             not sampled |                     855 |

The two-entity/part difference between the default and disabled captures is ordinary live-scene
fluctuation. Base object and dynamic draw counts remained identical. Both controls that bypass
outdoor PSSM nearly doubled frame rate and restored the median frame interval to one 60 Hz slot.
The `simple` control additionally proves that analytic entity grounding can remain enabled without
reintroducing the measured collapse.

### Conclusion

Outdoor PSSM caster preparation and submission are the proven dominant performance boundary in this
scene. This is not merely a correlation with a busy mob population: disabling that one renderer
feature while preserving the population and ordinary draw workload changes the outcome from 29 FPS
to nearly 60 FPS.

The residual 54 capped / 59 uncapped result also matters. The ordinary 855 dynamic draws and 2,686
parts consume nearly the remaining frame budget, so disabling shadows is a mitigation rather than
evidence that all non-shadow dynamic rendering is healthy.

## Residual Dynamic-Presentation Investigation

The shadow controls exposed a second defect rather than a healthy baseline. Approximately 60 FPS at
`1442 × 902`, render scale 1, with 44 visible entity roots remained too low. The following captures
used `simple` entity shadows so analytic grounding remained active while outdoor PSSM stayed absent.

### PSSM-free native CPU profile

A 100-microsecond V8 sample covered 7.130 seconds. The client displayed 53 capped / 60 uncapped FPS
during the profile. The largest application self times were:

| Function                           | Self time |
| ---------------------------------- | --------: |
| `formGroupedObjectInstanceRuns`    |  660.7 ms |
| `transformAABB3`                   |  286.1 ms |
| `frameTemplateBatchIdentityEquals` |  191.5 ms |
| `#drawObjectRange`                 |  149.1 ms |
| `#resolveSceneContributions`       |  140.4 ms |
| `#prepareFrameInstanceRuns`        |  132.6 ms |
| `opaqueObjectInstanceBatchKey`     |  105.1 ms |
| `resolveVariant`                   |  100.6 ms |
| Garbage collector                  |  678.0 ms |

Shadow-specific functions disappeared, but allocation-heavy instance grouping became the largest
application function and garbage collection remained approximately 9.5% of the sampled window.
The profile also exposed repeated compatibility checks, batch-key construction, matrix work,
instance attribute binding, contribution resolution, and scene-graph placement work.

### Opt-in renderer CPU/GPU profile

The client's existing renderer profiler was temporarily exposed to the non-interactive probe. The
measurement accumulated 424 CPU frames and 422 resolved GPU frames in the `simple` scene while a
native V8 profile ran alongside it. Native sampling added overhead, so use the phase ratios for
attribution and the unprofiled controls for frame-rate claims.

Renderer work per frame:

| CPU phase                     |          Mean | Share of total CPU |
| ----------------------------- | ------------: | -----------------: |
| Instance-run preparation      |      4.555 ms |              37.3% |
| Scene-contribution resolution |      3.004 ms |              24.6% |
| Opaque submission             |      1.983 ms |              16.2% |
| Other                         |      0.588 ms |               4.8% |
| Instance upload               |      0.506 ms |               4.1% |
| Blended ordering              |      0.465 ms |               3.8% |
| Remaining named phases        |      1.103 ms |               9.0% |
| **Complete renderer CPU**     | **12.204 ms** |           **100%** |

The recent CPU-frame p95 was 14.2 ms. The three dominant phases consume approximately 78% of
renderer CPU. Each frame prepared a mean 3,135 dynamic object inputs and 702 static inputs. These
are rigid draw-range inputs, not entity roots; the entity-to-part-to-range expansion is the relevant
distribution.

GPU elapsed phases:

| GPU phase                  |         Mean |
| -------------------------- | -----------: |
| Ambient occlusion          |     3.182 ms |
| Opaque objects             |     0.745 ms |
| Particles                  |     0.737 ms |
| Sky                        |     0.728 ms |
| Portal composition         |     0.709 ms |
| Terrain total              |     0.622 ms |
| Presentation               |     0.199 ms |
| **Sum of measured phases** | **7.361 ms** |

The GPU total is the sum of non-nesting elapsed phase queries, not frame wall time. CPU frame work is
larger than the measured GPU work, and the three CPU phases above dominate the remaining renderer
budget.

### Dynamic-presentation omission control

A temporary renderer control omitted dynamic contributions only after normal authority, IPC,
realization, camera, scene query, and static presentation remained active. `simple` grounding and
the ordinary static scene were otherwise unchanged. The client reported 59 capped / 317 uncapped
FPS, with 16.7 ms median and 16.8 ms p95 animation-frame intervals under the display cap.

This is a causal boundary, not a proposed fix: ordinary dynamic presentation reduces frame capacity
from approximately 317 FPS to the 57-74 FPS range seen in the neighboring controls. Network updates,
camera authority, the static scene, and the client shell cannot account for that difference because
they remained active.

### Ambient-occlusion control

Disabling AO beside `simple` entity shadows reduced mean measured GPU phases from 7.361 ms to 4.166
ms. The client nevertheless remained at 56 capped / 56 uncapped FPS with 16.7 ms median and 16.8 ms
p95 frame intervals. AO is a real 3.18 ms GPU quality cost, but it does not set the current frame
ceiling; CPU dynamic preparation remains dominant.

The AO-off CPU profile averaged 10.258 ms over 433 frames, but it did not run the native V8 sampler
alongside it. Do not interpret the difference from 12.204 ms as AO removing CPU work; the two CPU
windows had different profiling overhead.

### Over-partitioned dynamic instance cohorts

The ordinary dynamic submission constructs a `cohortKey` from landblock, render scope, and
`drawUnit.batchKey`. The draw-unit key includes the visual-template key and appearance identity.
`opaqueObjectInstanceBatchKey` then embeds that cohort alongside landblock, render scope, geometry,
and index range a second time. Exact compatibility independently compares prepared geometry,
material, range, scope, source, shadow reception, and instance semantics.

A diagnostic control removed only the template-derived cohort equality and cohort-key segment from
the outer candidate key. Exact compatibility remained authoritative. An immediate restored-key
control observed the same 54 visible entities and 3,247 dynamic parts:

| Fact                 | Narrow template cohort | Broader exact-compatible cohort |    Difference |
| -------------------- | ---------------------: | ------------------------------: | ------------: |
| Dynamic draws        |                    945 |                             636 | -309 (-32.7%) |
| Total object draws   |                  1,083 |                             774 | -309 (-28.5%) |
| Uncapped FPS display |                     74 |                             107 |  +33 (+44.6%) |
| Capped FPS display   |                     58 |                              59 |            +1 |

The equal draw-count delta proves all 309 removed submissions were dynamic. The result did not hide
entities, reduce parts, alter material compatibility, or relax exact draw-state comparison. The FPS
magnitude is a single A/B pair and requires repeated acceptance runs, but the deterministic draw
partition defect is proven: template identity prevents otherwise exact-compatible parts from being
instanced together.

### Revised conclusion

There are two independent dominant renderer problems:

1. Outdoor PSSM repeats expensive caster expansion, grouping, encoding, and submission across three
   cascades, reducing this scene from approximately 57 FPS to 29 FPS.
2. Ordinary dynamic rendering rebuilds thousands of allocation-heavy frame submissions and splits
   exact-compatible parts by template identity. It reduces the PSSM-free scene from approximately
   317 FPS without dynamic presentation to 57-74 FPS with it. Broader exact-compatible grouping alone
   raised one same-population result to 107 FPS while removing 309 draws.

AO is a separate 3.18 ms GPU quality cost but is not the current bottleneck. IPC event pressure is
real but survives both causal renderer controls and does not explain either large step.

## Code-Path Findings

The shared renderer owns the expensive behavior; it is not a Svelte or client-shell reactivity
problem.

1. `WebGL2OutdoorPssmPass.render` iterates all three cascades. Each cascade independently calls
   `collectOutdoorPssmCasters`, then uploads and draws its selected instance population.
2. `collectOutdoorPssmCasters` performs a light-frustum scene query, expands every retained dynamic
   root into rigid contributions, resolves those contributions, allocates one caster-part record per
   accepted part, and batches the resulting population.
3. `formOutdoorPssmCasterRuns` calls the generic grouped-instance primitive separately for each
   cascade, flattens the grouped records into another array, then creates run records.
4. `casterBatchKey` allocates an array and joined string from landblock, geometry, range, and cull
   face for every selected part in every cascade. `formGroupedObjectInstanceRuns` allocates a new
   `Map`, per-key run arrays, submission records, and per-run value arrays each invocation.
5. `#drawCascade` encodes the selected instance transforms into the frame buffer and binds instance
   attributes for each run. This is required by the current packing scheme, but it compounds the
   repeated CPU preparation with WebGL submission work.
6. The default policy selects three 2048-square cascades covering 192 world units. Resolution may
   influence GPU time, but it cannot explain the measured JavaScript batching, transform, and GC
   costs by itself.
7. Ordinary dynamic resolution creates approximately 3,100 frame-current object submissions from
   roughly 45-54 visible entity roots. Each accepted draw range allocates a submission and constructs
   a cohort string even though geometry, material, and range facts are stable template data.
8. `#prepareFrameInstanceRuns` allocates fresh phase, instance, output, run-count, map, run, and value
   arrays every frame, then flattens the grouped values into another instance array and creates
   replacement submission objects.
9. The narrow cohort key embeds stable template and appearance identity. Exact prepared
   compatibility is already authoritative, so this additional restriction blocks legal batching
   across templates and preserves hundreds of draw calls in the measured population.
10. The current draw loop rebinds instanced matrix attributes for every surviving run. Reducing run
    count therefore saves both JavaScript grouping work and WebGL submission calls.

Relevant sources:

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-outdoor-pssm-pass.ts`
- `apps/holtburger-3d/src/lib/game/renderer/outdoor-pssm-casters.ts`
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-instance-buffer.ts`
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/object-visual-template-repository.ts`
- `apps/holtburger-3d/src/lib/frontend-tuning.ts`

## Proposed Implementation Scope

The scope is deliberately staged. The ordinary dynamic path is the first production correction
because it is active in every shadow mode and already has a causal draw-count control. PSSM follows
only after the ordinary path is re-profiled; otherwise shadow work would be optimized on top of a
known over-partitioned submission pipeline.

Changing the client default from `shadow-maps` to `simple` is an optional product mitigation, not a
performance fix. It can be shipped independently if directional entity shadows are temporarily less
important than responsiveness, but it does not satisfy this plan's acceptance target.

### Proposed north stars

These targets need product-owner confirmation before implementation acceptance:

- At `1442 × 902`, render scale 1, and the corrected live population, sustain at least 144 uncapped
  FPS in `simple` mode across five steady-state captures. This corresponds to a 6.94 ms whole-frame
  budget and makes “faster than the monitor cap” measurable rather than inferred.
- With `shadow-maps`, sustain at least 120 uncapped FPS or keep PSSM's incremental CPU cost below
  1.0 ms at the same population. The timing target wins if GPU shadow quality prevents the FPS target
  on the test hardware.
- Preserve entity population, visible rigid-part count, animation, material appearance, translucency
  order, portal scope, and shadow caster membership. Workload removal is not optimization.
- Keep production growth through the committed phases below approximately 300 lines after deleted
  and collapsed paths are counted. Crossing 500 new production lines requires a design resteer.

The current 107-FPS broad-cohort control does not meet the first target. It proves the first fix and
also proves that batching alone is insufficient.

## Execution Log

### Completed decisions through Phase 3

| Gate    | Decision and evidence                                                                                                                                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | Temporarily retain an opt-in one-frame merge census and exact FPS/profile controls in the non-interactive client probe. Repeated live frames held at 3,247–3,249 rigid inputs. The census consistently attributed 309 cohort-prevented merges to 233 opaque, 59 far-transparent, 17 near-transparent, and zero additive draws. Phase 7 removed those surfaces. |
| Phase 1 | Broaden only opaque grouping. Compiled compatibility is authoritative; transparent and additive phases still require their semantic cohort. Production moved from 945 cohort-constrained dynamic draws to 712, while preserving the 3,247-input workload and the 62 far-transparent plus 18 near-transparent draws.                                            |
| Phase 2 | Proceed. The corrected ordinary path still spent 7.019 ms renderer CPU; scene contribution resolution (2.160 ms) plus instance-run preparation (1.710 ms) owned 3.870 ms, or 55% of the renderer frame. The matched simple-mode ceiling was 93.37 uncapped FPS.                                                                                                |
| Phase 3 | Move stable facts to their owners. The final matched capture held 3,247 inputs, 712 dynamic draws, and 850 total object draws while reaching 139.78 uncapped FPS. Renderer CPU fell to 4.351 ms; scene contribution resolution plus run preparation fell to 1.714 ms. This clears both the 2.0-ms whole-renderer and 50% paired-phase gates.                   |

### Phase 3 implementation and resteers

| Change                                                                                | Result                                                                                                                                                                                                                                                 | Disposition                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove `RenderWorld.resolveDynamicContributions()` wrapper mapping                    | Renderer CPU was neutral (7.019 → 7.041 ms in adjacent captures).                                                                                                                                                                                      | Retained because it deletes duplicate ownership and allocation without adding an abstraction; not counted as a performance win.                                                                                                                                                                                                                          |
| Intern compiled exact draw identity                                                   | Instance-run preparation fell from 1.764 to 0.857 ms; renderer CPU fell from 7.041 to 6.550 ms.                                                                                                                                                        | Superseded during the final quality audit: its strong process-lifetime catalog contradicted weak compiled-draw eviction. Compiled coarse partitions now avoid frame key construction while exact compatibility remains authoritative. The earlier timing is historical evidence for the superseded variant, not acceptance evidence for the final shape. |
| Store part-to-visual-root transforms and resolve visual-root ancestry once per entity | Scene contribution resolution fell from 2.409 to 1.571 ms; renderer CPU fell to 5.728 ms.                                                                                                                                                              | Retained. This moves placement and spatial-membership derivation to the entity boundary.                                                                                                                                                                                                                                                                 |
| Compose scaled part transforms directly into retained matrices                        | Renderer CPU fell to 5.061 ms; scene contribution resolution plus run preparation reached 2.198 ms.                                                                                                                                                    | Retained. The implementation preserves the exact transform contract without temporary matrices or part-record replacement.                                                                                                                                                                                                                               |
| Reuse per-entity contribution/instance storage                                        | A matched capture measured 4.977 ms renderer CPU and 121.82 uncapped FPS. A native profile's GC self-time fell from 247.7 ms over 4.08 s to 143.3 ms over 3.82 s, but changing scene density prevents attributing the entire reduction to this change. | Retained for its explicit borrowed-lifetime contract and reduced allocation pressure; the uncertain isolated speedup is not claimed.                                                                                                                                                                                                                     |
| Derive portal-domain routing once per entity and omit opaque-only transparent keys    | Final matched capture measured 4.351 ms renderer CPU, 1.089 ms scene contribution resolution, 0.625 ms run preparation, and 139.78 uncapped FPS.                                                                                                       | Retained. All parts inherit one visual root, so per-part routing derivation was redundant by contract.                                                                                                                                                                                                                                                   |

The renderer CPU improvement from the Phase 2 baseline is 2.668 ms (38.0%). The paired stable-fact
phases improved by 2.155 ms (55.7%). Mean GPU time also varied from 6.89 to 6.58 ms across these
captures, so the CPU ownership claim rests on named CPU phases and unchanged workload rather than
FPS alone.

### Phase 4 shadow gate

The matched profiler-off gate used the same binary and retained 3,247 rigid dynamic inputs and 712
dynamic draws:

| Shadow mode   | Uncapped FPS | Renderer CPU mean | GPU mean | PSSM CPU | PSSM GPU |
| ------------- | -----------: | ----------------: | -------: | -------: | -------: |
| `none`        |       143.14 |          4.129 ms | 6.471 ms |        0 |        0 |
| `simple`      |       139.78 |          4.351 ms | 6.583 ms |        0 |        0 |
| `shadow-maps` |        53.25 |         11.485 ms | 9.038 ms | 6.879 ms | 0.773 ms |

The pre-Phase-5 PSSM frame issued three queries, selected 13,509 caster parts, formed 1,243 depth
runs, and encoded/uploaded approximately 1.08 MB in three uploads. PSSM exceeded every Phase 4
entry gate, so Phase 5 proceeded. The receiver-side GPU delta is larger than the measured shadow
map phase alone: enabling PSSM also increased near-terrain shading from approximately 0.62 to 1.85
ms because terrain samples the cascade maps.

### Phase 5 root ownership result

The implemented collector consumes all three reused scene-query buffers into a root-to-cascade
bitmask, filters each unique candidate once, expands each eligible root once, and distributes one
borrowed caster record to every selected cascade. A renderer-frame expansion map also lets ordinary
camera/portal selection reuse roots already expanded by PSSM. Material-free geometry range and cull
state compile into a stable depth identity; material state that the depth shader does not consume is
excluded. Caster, grouping, and run records now retain bounded high-water storage instead of being
rebuilt as object graphs every frame.

The live workload contains 112 unique retained caster roots but approximately 235 root-cascade
memberships, or 2.10 cascades per root. A later, heavier capture selected 15,316 caster parts and
formed approximately 1,300 depth runs. Despite the 13% part-count increase from the Phase 4 capture,
PSSM CPU measured 5.069 ms and whole-renderer CPU 10.448 ms; profiler-off throughput reached 57.44
FPS. GPU PSSM time remained approximately 0.73 ms. The structural change therefore removes roughly
1.5–1.8 ms from the PSSM CPU path, but does not meet the proposed 120-FPS or sub-1-ms incremental
shadow target.

The final native sample corroborated the then-observed shape. Over 4.74 seconds, instance encoding
owned 244.2 ms self-time, caster collection 149.0 ms, run formation 120.5 ms, and garbage collection
157.7 ms. The earlier pre-pooling Phase-5 sample spent 232.7 ms in GC over 4.90 seconds, so pooled
storage materially reduced allocation pressure even under a heavier caster workload. The remaining
cost was dominated by cascade-specific records and approximately 1,300 WebGL draw submissions, not
repeated root expansion alone. The later material-range census below proves those submissions were
not all irreducible: visible-material partitioning still survived in their index ranges.

### Phase 6 experiment and stop decision

The narrow single-upload experiment concatenated the unchanged three cascade-specific instance
arrays and retained a per-cascade base offset. It reduced upload count from three to one but kept
approximately 1.16 MB of encoded records. In the matched live capture PSSM CPU regressed from 5.376
to 5.737 ms, whole-renderer CPU from 10.458 to 11.612 ms, and throughput from 52.84 to 47.09 FPS. The
branch was reverted. The experiment proves that call count is not the encoding boundary; record
cardinality is.

Further work now crosses the plan's explicit scope boundary. Reaching the shadow target requires one
of:

- a frontend quality-policy change that reduces cascade count, maximum shadow distance, or caster
  admission;
- a substantially larger renderer project that repacks compatible geometry, introduces a portable
  multi-draw strategy, or changes the instance addressing model; or
- accepting approximately 55–60 FPS for the current full-PSSM policy while ordinary and simple
  modes remain near the 144-Hz target.

No one of these is selected here. Phase 7 final acceptance and diagnostic cleanup are paused until
the product/architecture owner chooses the intended shadow contract.

### Phase 6B material-range fragmentation census and course correction

The stop decision above was premature. The depth shader is material-free, but its input remained one
`RigidPartDrawUnit` per contiguous visible-material range. The depth identity excluded material
state while retaining each range's exact `indexStart` and `indexCount`, so authored material
boundaries continued to partition both instance records and draw calls.

A profiler-only read-only census formed the schedule that would result from joining adjacent ranges
when their instance, geometry, landblock, and effective cull face match. These are exactly the facts
consumed by the current depth pass; ordering, textures, palette state, alpha, and lighting are absent
from its shaders and draw state. The census does not alter submitted batches. Two independent live
sessions produced the same latest-frame schedule:

| Depth schedule fact                          |   Current | Adjacent-range schedule | Reduction |
| -------------------------------------------- | --------: | ----------------------: | --------: |
| Cascade-specific caster records              |    15,610 |                   5,225 |     66.5% |
| Instance upload bytes                        | 1,248,800 |                 418,000 |     66.5% |
| Instanced depth runs                         |     1,301 |                     404 |     68.9% |
| Submitted singleton runs                     |       496 |        not yet censused |         — |
| Coalesced runs ignoring landblock addressing |         — |                     272 |         — |

The 132-run difference between 404 and 272 isolates the current landblock-offset uniform as a real
remaining partition. It does not justify the other 897 draws. The current schedule's 496 singleton
runs are 38.1% of all submissions, further explaining why ordinary instancing could not rescue the
material-sliced schedule.

The content contract makes the join exact rather than heuristic:

- `resolveObjectMaterialRanges` visits every triangle in index order and emits contiguous,
  gap-free ranges; material boundaries are the only reason adjacent ranges remain separate.
- All ranges of one active rigid part share the same reusable instance record and therefore the
  same source-to-landblock transform and per-entity state.
- The PSSM caster shader consumes only position, instance transform, light clip, and landblock
  offset. The pass-wide polygon offset is unchanged. Cull face is the only material-derived raster
  fact and remains a hard merge boundary.
- The current pass already writes opaque depth for transparent and cutout material ranges. Joining
  equally culled adjacent ranges does not add a new alpha or ordering behavior; it submits the same
  triangles in the same authored index order with fewer API calls.

The narrow implementation is to compile independent material and depth ranges while the visual
template owns the complete ordered source range list. Dynamic expansion returns one composite
result containing both contribution sets: the producer computes the part transform, landblock, and
scopes once; ordinary rendering consumes the material set; PSSM consumes the depth set. This deletes
PSSM's dependency on material draw units without introducing a second transform/placement pass.

The depth range is a small renderer-neutral rigid-part contract containing geometry, contiguous
index interval, and cull face. It carries no texture, ordering, palette, or material identity. The
PSSM depth catalog resolves only geometry residency and cross-template instancing identity from that
contract. The old material-range lookup path is removed in the same cutover.

This is expected to be approximately 100–180 production lines plus focused template, dynamic
expansion, collector, and pass fixtures. It does not require geometry repacking, multidraw extensions, a new
instance-addressing model, or a shadow-quality reduction. Runtime acceptance still requires a real
implementation A/B; the census proves schedule cardinality, not the resulting CPU/FPS improvement.

### Phase 6C implementation and acceptance result

The clean cutover landed with independent template-owned material and depth ranges. Dynamic
expansion publishes both through one borrowed composite so the part transform, landblock, and scope
facts are computed once. PSSM consumes only depth contributions; ordinary rendering consumes only
material contributions. A material-only request omits depth records entirely, and the renderer's
frame cache can explicitly upgrade it if consumer order ever changes.

The five profiled live captures held 112 unique retained caster roots and 394 compatible depth runs.
Their current camera produced approximately 215 mean root-cascade memberships rather than the 239
in the pre-implementation census, so caster-record totals are compared by schedule equivalence and
range rather than pretending the two light-frustum populations were identical.

| Implemented shadow-map fact   |                Five-run result |
| ----------------------------- | -----------------------------: |
| Compatible depth runs         |                   394 in all 5 |
| Mean cascade-specific records |              4,731–4,740/frame |
| Latest stable record count    |                          4,782 |
| Latest instance upload        |                  382,560 bytes |
| PSSM CPU mean                 |  2.980 ms median (2.733–3.299) |
| PSSM GPU mean                 |  0.620 ms median (0.609–0.648) |
| Whole-renderer CPU mean       |  7.943 ms median (7.537–8.340) |
| Uncapped throughput           | 73.16 FPS median (70.29–74.55) |

During structural acceptance the temporary what-if census reported the submitted and coalesced
schedules as identical on every frame, proving production reached the modeled range/run
cardinality. Its first five-run timing window measured 4.48 ms median PSSM CPU, but deleting the
census removed approximately another 1.2–1.5 ms: the diagnostic was materially perturbing the path
it measured. Those timings are discarded. The table above is a new five-run distribution from the
cleanup-complete build. The ordinary retained PSSM counters are sufficient to reproduce the landed
schedule without the temporary census or its four profile metrics.

The earlier clean Phase 5 capture measured 5.069 ms PSSM CPU and 57.44 uncapped FPS with 15,316
records, approximately 1,300 runs, and 235 root-cascade memberships. The cleanup-complete Phase 6
median is approximately 2.09 ms (41%) lower and throughput is approximately 27% higher. The current
light frusta average approximately 215 memberships, 8.5% fewer, so this is a strongly directional
before/after rather than a perfectly population-matched timing claim. The exact structural result is
the stable 394-run schedule and threefold record reduction. The implementation still does not clear
the 120-FPS/sub-1-ms Phase 4 target.

A clean 4.53-second native sample after deleting the census found 278.9 ms in
`getVisibleContributions`, 184.9 ms in shared instance encoding, 88.1 ms in caster collection, 66.6
ms in instance-attribute range binding, and 46.3 ms in caster-run formation. The first two are shared
with ordinary rendering: PSSM runs first and therefore receives their renderer-phase charge even
though the ordinary view consumes the cached material contributions afterward. The remaining PSSM
schedule still has approximately 4,700 cascade-specific records and 394 WebGL submissions.

A `simple` control after making depth production explicit reported zero for every outdoor-shadow
counter, 5.076 ms whole-renderer CPU, and 119.23 uncapped FPS. It is a one-run isolation control, not
a replacement five-run acceptance distribution. It proves the composite contract adds no PSSM
query, record, upload, or draw work when map shadows are inactive.

The next decision is therefore narrower than before: material boundaries are gone. Further
full-quality work must address actual cascade-specific record encoding and WebGL submission—most
plausibly landblock/geometry consolidation—or revise caster/cascade quality policy. Reintroducing
material knowledge into PSSM is not an available branch.

### Verification at the pause point

- `npm run check` passed with zero Svelte diagnostics and all TypeScript project checks clean.
- TypeScript ESLint and `knip` passed after removing one diagnostic-only exported type with no
  external consumer.
- All 227 Vitest files and 1,692 tests passed.
- `npm run format:check`, `npm run check:terrain-shader`, and `git diff --check` passed.
- `npm run lint:rust` did not reach the app host: workspace Clippy stopped in untouched
  `crates/holtburger-weenie-catalog/src/reader.rs:80` because the current toolchain newly recommends
  `as_chunks` over its existing `chunks_exact` call. This performance change does not modify that
  crate, and no lint suppression or unrelated fix was added.
- The raw diff at that pause still included the investigation UI/probe and focused fixtures. Its source
  growth is above the plan's preferred steady-state range. Phase 7 must prune diagnostic surfaces
  without a named regression consumer and reassess the remaining production delta before
  acceptance; that state was a decision-ready engineering branch, not a cleanup-complete
  landing candidate.

### Surprises, concessions, and active debt

- The broad diagnostic initially appeared to justify 309 production draw merges. The phase census
  proved 76 of those were transparent ordering cohorts; production deliberately leaves those draws
  split. The safe opaque result is 233 removed draws.
- An early probe captured FPS after scheduling the expensive one-frame census and understated the
  ordinary-path ceiling. The probe now records its steady-state FPS before census capture. Results
  produced by the old ordering are not used as acceptance evidence.
- The Phase 0 proposal asked for five alternating narrow/broad production variants. Keeping a broad
  transparent-grouping toggle would preserve a knowingly invalid renderer behavior. The retained
  replacement is a read-only census exercised across repeated live frames plus deterministic phase
  fixtures. Final five-run acceptance remains Phase 7 work.
- The CPU profiler materially depresses FPS. Native samples are used for attribution only; FPS
  comes from profiler-off captures.
- Debug shadow/profile controls and the census UI currently have a named investigation consumer.
  Phase 7 must either retain them as an explicit regression surface or delete the UI exposure while
  keeping the non-interactive probe contract.
- Phase 3 introduced a borrowed contribution lifetime: an entity's returned array and records are
  valid only until that same entity is expanded again. Current renderer and PSSM consumers are
  synchronous. Phase 5 must preserve that constraint or replace it explicitly, not accidentally
  retain mutable frame records.
- Phase 5 preserves that lifetime by keeping the expansion cache renderer-frame-local and clearing
  it before the next frame. PSSM batches retain borrowed instance references only until all cascade
  draws complete synchronously.
- The one-upload Phase 6 branch was measured and reverted; no vestigial base-offset or concatenated
  arena path remains.

### Phase 0 — Make the two controls repeatable — COMPLETE

**Purpose:** turn the one-off causal probes into a bounded benchmark and classify the 309 eliminated
draws before changing renderer semantics.

**Deliverables:**

- Extend the non-interactive live client probe to record viewport, render scale, shadow policy,
  visible dynamic roots, rigid parts, dynamic inputs, per-ordering-class runs/draws, FPS, and frame
  interval distribution in one result.
- Add an opt-in merge census that counts exact-compatible values split only by template-derived
  cohort identity. Report opaque, near-transparent, far-transparent, and additive populations
  separately.
- Run narrow and diagnostic-broad grouping in alternating order, five captures per variant. Keep the
  character stationary and reject captures whose population differs materially.
- Add a deterministic renderer fixture for grouping correctness. Do not retain a test that depends
  on local runtime assets or the live account.

**Acceptance gate:** the live census explains which ordering classes own the removed draws, repeated
captures preserve the measured direction, and the fixture reproduces the compatibility boundary.
If transparent or additive draws materially contribute to the gain, do not broaden them in Phase 1;
scope their ordering semantics separately.

**Expected size:** 120–220 diagnostic lines, mostly removable; no product behavior change.

### Phase 1 — Correct opaque dynamic batch partitioning — COMPLETE

**Purpose:** stop template/appearance identity from splitting opaque instances that already have
identical draw-consumed state.

**Deliverables:**

- Make exact prepared draw compatibility authoritative for opaque frame-instance runs. Preserve
  source, render scope, landblock, geometry/index range, prepared material and device state,
  outdoor-shadow reception, and instance representation.
- Remove template-derived cohort identity from only the opaque candidate partition and opaque
  equality path. Preserve the existing cohort and stable-order rules for transparent rendering.
- If `cohortKey` becomes transparent-only, rename it to describe that contract and sweep the old
  vocabulary from surviving symbols, tests, metrics, and documentation.
- Add focused unit cases showing that different templates/appearances with equal opaque prepared
  state coalesce, while every draw-consumed difference still splits. Preserve near/far transparent
  output order byte-for-byte in the deterministic fixture.

**Acceptance gate:** matched live captures reduce dynamic draws without reducing inputs or visible
parts; representative palette, clothing, animated-part, portal, and translucency scenes render
correctly; uncapped throughput improves with no opaque GPU-time regression.

**Expected size:** approximately -5 to +40 production lines and 80–140 focused test lines. If this
requires a new generic batching framework, stop: the narrow semantic correction has been lost.

### Phase 2 — Resteer from a fresh ordinary-path profile — COMPLETE

**Purpose:** avoid carrying the original profile's ranking past a material topology change.

**Deliverables:**

- Capture unprofiled five-run distributions in `simple` mode, the checked-in renderer CPU/GPU phase
  profile, and a native V8 CPU sample.
- Re-rank `instance-run preparation`, `scene contribution resolution`, `opaque submission`, instance
  encoding/upload, garbage collection, and actual GPU phases.
- Record dynamic inputs per frame beside every per-frame cost so a changing population cannot look
  like an implementation win.

**Decision gate:** stop ordinary-path work if the confirmed north star is met. Proceed to Phase 3
only if stable-fact reconstruction/allocation remains at least 2.0 ms per frame or 25% of renderer
CPU. Do not optimize whichever function happens to top a single sampled profile.

### Phase 3 — Move stable dynamic draw facts out of the frame loop — COMPLETE

**Purpose:** retain only visibility, transform, pose, color, and ordering facts as frame-current
work.

**Deliverables:**

- Compute immutable geometry/index range, prepared material/device compatibility, render-domain
  eligibility, and a stable coarse batch partition once at the compiled draw/template owner.
- Collapse the duplicate dynamic contribution wrapping in `RenderWorld` and the renderer. Prefer a
  caller-owned reusable output/scratch contract over `flatMap`/`map` object graphs, while keeping the
  API small and explicit about lifetime.
- Reuse frame arrays and grouping storage with bounded high-water retention. Keep changing instance
  values out of caches and clear ownership on entity replacement, removal, template supersession,
  and portal-scope changes.
- Remove per-frame composite cohort/key construction where a stable compiled partition now exists.
  Keep exact compatibility authoritative rather than adding a longer-lived interner whose retention
  exceeds the weak compiled-draw cache it indexes.

**Acceptance gate:** renderer `instance-run preparation` plus `scene contribution resolution` falls
by at least 50% from the Phase 2 baseline and whole-frame CPU falls by at least 2.0 ms. Dynamic input,
draw, and visual results remain identical to Phase 1. Native samples show materially less GC rather
than moving allocation under a different function name.

**Expected size:** 150–300 production lines and 120–220 test lines, offset by removing duplicate
mapping/key paths. If the production delta exceeds 500 lines, stop and redesign the ownership
contract.

### Phase 4 — Resteer before shadow work — COMPLETE

**Purpose:** establish the corrected non-PSSM ceiling and isolate PSSM's remaining incremental cost.

**Deliverables:**

- Repeat `none`, `simple`, and `shadow-maps` on the same binary and matched population.
- Capture PSSM query count, unique roots, selected caster parts per cascade, compatible depth runs,
  upload count/bytes, renderer CPU/GPU phases, and a native sample.
- Measure how often one entity root is selected by multiple cascade frusta and how much contribution
  resolution is repeated inside one frame.

**Decision gate:** proceed to Phase 5 only if PSSM still adds more than 1.0 ms CPU, more than 10% of
the corrected frame, or prevents the confirmed shadow target. The earlier 135-part PSSM result from
a smaller scene is not transferable evidence for this multipart population.

### Phase 5 — Resolve PSSM caster roots once per frame — STRUCTURALLY COMPLETE

**Purpose:** remove repeated stable and current-frame caster work while retaining independent
cascade visibility.

**Deliverables:**

- Query each cascade and build a current-frame root-to-cascade bitmask, fully consuming the reused
  query buffer before the next query.
- Resolve placement, current pose, draw contribution, and stable depth-draw identity once for every
  unique selected root. Distribute resolved parts to per-cascade scratch storage using the bitmask.
- Preserve union-based off-camera animation liveness: a root selected by any cascade remains live.
- Move immutable depth compatibility to the compiled draw owner. Depth identity includes every state
  consumed by the shadow draw, such as geometry/index range and cull behavior, but excludes material
  state the depth pass does not read.
- Reuse cascade batch/run storage. Keep per-cascade selection and draws explicit; do not cache final
  cascade membership across frames.

**Acceptance gate:** each selected root resolves once, while caster parts, runs, upload values, and
rendered shadow membership remain equivalent per cascade. PSSM CPU falls enough to meet the Phase 4
gate, GPU time does not regress, and the live five-run distribution improves.

**Expected size:** 120–250 production lines and 120–220 test lines.

### Phase 6 — Shadow schedule correction — COMPLETE

**Purpose:** remove visible-material boundaries from the material-free depth schedule before any
quality reduction or larger submission architecture is considered.

The single-upload experiment remains rejected: it changed upload call count without reducing record
cardinality. Compile adjacent same-cull depth ranges at visual-template preparation. Return material
and depth contributions together from one dynamic expansion, then cut ordinary rendering and PSSM
over to their respective sets. Delete PSSM's material-draw-unit input path. Preserve geometry,
landblock, cull face, transform, root/cascade membership, and every submitted triangle.

**Acceptance gate:** deterministic fixtures prove triangle/raster-state equivalence and live
captures approach the 5,225-record/404-run census without changing root/cascade membership. Then
repeat the Phase 4 shadow timing gate. Reconsider packing only if upload/binding overhead remains
material after record cardinality falls. Multi-draw, geometry repacking, worker rendering, and a
renderer backend rewrite remain outside this scope.

### Phase 7 — Diagnostic cleanup complete; final acceptance open

**Deliverables:**

- Remove diagnostic toggles, counters, and fixtures that have no named ongoing consumer. Retain only
  the live probe output needed to reproduce the regression and focused deterministic tests.
- Sweep renamed batching vocabulary from code, metrics, UI labels, and this worksheet.
- Run `npm run check`, `npm run lint`, `npm run test:ts`, `npm run format:check`, and
  `npm run check:terrain-shader` from `apps/holtburger-3d`.
- Run the real-GPU live probe against both the development client and an optimized production bundle.
  Record five-run distributions, workload counters, renderer timings, native corroboration, console
  cleanliness, and representative screenshots.
- Update this worksheet with actual decisions, rejected branches, and before/after evidence.

**Cleanup outcome:** the temporary shadow-fragmentation census, its profile fields, and its fixture
were removed after the submitted schedule matched it. A second cleanup audit removed the dynamic
merge census end to end, the client debug-panel shadow/profile/census controls, the client-session
mutation contracts created for them, the probe-only DOM attributes, and the live probe's temporary
performance modes. Renderer profiling and shadow-policy controls remain available through the
agent-owned browser harness and the Explorer Frame/Shadow panels rather than through production
client UI. This subtraction reduced the tracked working diff from 31 touched files and 1,299 net
added lines to 22 files and 724 net added lines; untracked focused production/tests and this
worksheet are excluded from both snapshots.

`npm run check`, TypeScript ESLint, `knip`, all 225 Vitest files and 1,690 tests,
`npm run format:check`, terrain shader validation, live-probe syntax validation, and
`git diff --check` pass. Five cleanup-complete shadow-map captures and one explicit no-PSSM `simple`
control completed before the temporary probe surfaces were removed, with no browser exceptions or
console errors. A final real-GPU outdoor-PSSM harness cycle also completed without console errors and
successfully exercised shadow disable/enable and 2048-to-256-to-2048 target replacement. That fixture
contained no visible dynamic entities, and the machine was battery-throttled, so the run is lifecycle
evidence only; its timings are deliberately discarded. `npm run lint:rust` remains blocked outside
this frontend change: Rust 1.98 reports `chunks_exact` warnings in untouched
`holtburger-weenie-catalog`, `holtburger-content`, and `holtburger-protocol`, plus an existing
question-mark simplification in `holtburger-protocol`. No suppression or unrelated Rust edit was
added.

The cleanup gate is complete, but the phase's final-acceptance gate and the overall plan remain open:
the measured full-PSSM path does not satisfy the proposed 120-FPS/sub-1-ms target, and no replacement
shadow-quality contract has been selected. An optimized production-bundle acceptance distribution
is therefore intentionally deferred until that product/architecture decision is made.

**Pre-commit quality audit:** the audit removed two process-lifetime exact-identity catalogs whose
strong values defeated the weak retention policy of compiled draws and depth units. Stable batch
partitions remain compiled once, with existing exact compatibility checks as the collision guard.
The shadow collector now computes diagnostic counters only when profiling supplies a sink; ordinary
frames allocate no collection-result object and do no population accounting. Dynamic contribution
scope and landblock facts moved from every part onto a visible/hidden contribution-set contract, so
consumers no longer infer entity-wide invariants from element zero. Reusable PSSM groups clear
borrowed instance references after flattening, release retired high-water entries when population
shrinks, and release all active payloads when shadows are disabled or destroyed.

## Risks and Failure Modes

- **Transparent ordering regression:** globally removing cohort equality would change adjacent and
  far-transparent grouping. The first production change is opaque-only; transparent and additive
  behavior require separate evidence.
- **Hidden compatibility state:** two draws that look equal in a partial key may differ in consumed
  WebGL state. Phase 1 retains exact prepared compatibility and adds one split test per consumed
  field.
- **Broad-key collision cost:** broad candidates can turn a linear grouping pass into repeated
  `runs.find` scans. The merge census must report bucket width; Phase 3 can introduce a stable exact
  identity only if collision data earns it.
- **Stale cached presentation:** animation, palette, entity replacement, or portal membership can
  invalidate apparently stable facts. Ownership and invalidation tests precede reuse.
- **Opaque early-Z regression:** legal batching can still reorder opaque work and increase GPU
  overdraw. Accept only with GPU phase timing and representative visuals, not CPU FPS alone.
- **PSSM liveness regression:** deduplicating roots must preserve the union of all cascade selections
  for off-camera animated casters.
- **Live-scene drift:** use alternating runs, record population beside timings, and keep a
  deterministic asset-independent fixture for correctness.
- **Profiler distortion:** use profiled captures for attribution and separate unprofiled captures for
  throughput. Final evidence must include an optimized production bundle.
- **Unbounded scratch retention:** reusable arrays reduce churn but can pin a one-time population
  spike. Record high-water capacity and use a measured shrink policy only if it becomes a problem.

## Definition of Done

The fix set is complete only when:

1. The agreed ordinary and shadow north stars pass across five matched live captures.
2. Entity roots, rigid parts, dynamic inputs, animation, visibility, portal scope, translucent order,
   and per-cascade caster membership remain equivalent.
3. The renderer profile and native sample agree on the removed work; no claim rests on FPS alone.
4. The implementation computes each stable draw fact once at its owning layer and does not add a
   client-specific policy to authoritative world state.
5. The relevant TypeScript checks, lint, tests, formatting, and terrain shader validation pass with
   no ignored warnings.
6. Temporary diagnostics are removed or have a named reproducibility consumer.
7. This worksheet contains the final before/after tables, decisions at every gate, and any deferred
   work.

## Open Decisions

- Confirm whether the measured 139.78-FPS `simple` result is close enough to the proposed 144-FPS
  north star to proceed to five-run acceptance, or whether more ordinary-path work is desired.
- Choose whether the next full-PSSM phase consolidates landblock/geometry submission, reduces
  caster/cascade quality policy, or accepts the current approximately 60-FPS full-quality result.
  Material-range fragmentation is fixed and no longer belongs in that decision.
- Confirm or replace the proposed 120-FPS/sub-1-ms incremental PSSM target. The current full-quality
  implementation cannot meet it through root deduplication and allocation removal alone.
- Phase 0 found zero additive inputs in the live workload. Additive grouping remains
  cohort-constrained; no unobserved semantic broadening was made.

## Rough Scope Summary

| Work package                          |   Product delta | Test/diagnostic delta | Gate          |
| ------------------------------------- | --------------: | --------------------: | ------------- |
| Repeatable benchmark and merge census |         0 lines |         120–220 lines | Required      |
| Opaque batch semantic correction      | -5 to +40 lines |          80–140 lines | Required      |
| Stable dynamic draw ownership         |   150–300 lines |         120–220 lines | Profile-gated |
| PSSM root deduplication               |   120–250 lines |         120–220 lines | Profile-gated |
| Compiled PSSM depth-range coalescing  |   100–180 lines |          80–150 lines | Required next |
| Shadow upload/packing                 |         Unknown |               Unknown | Optional      |

The committed path is one narrow semantic correction followed by two profile-gated structural
phases. A reasonable planning range is 6–10 focused engineering days through PSSM root
deduplication, excluding the optional packing phase. The stop/go gates are part of the estimate:
they are intended to prevent the plan from becoming a speculative renderer program.
