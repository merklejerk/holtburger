# Investigation: Generated Scenery Layer Performance Impact

This document details the CPU and GPU performance analysis of the generated scenery/objects static layer in [`apps/holtburger-3d`](file:///home/cluracan/code/holtburger/apps/holtburger-3d). It captures profiler evidence gathered on outdoor landblock `0xda55ffff` looking out across the horizon, isolates each contributing mechanism in the runtime and renderer, and evaluates remediation paths.

> **Revised 2026-08-18:** a follow-up capture on the same scene re-measured the GPU pass split and added V8 sampling-profile attribution (harness `--cpu-profile`). The original per-pass GPU rows misattributed the added GPU cost to the terrain pass; the corrected split and the function-level CPU evidence are in sections 1.1, 2.6, and 2.7. CPU phase buckets and totals reproduced within noise.

---

## 1. Executive Summary & Profiler Evidence

Enabling the generated scenery layer across standard Explorer residency radii (terrain/buildings: 8, generated: 2) results in:

- **CPU Frame Time:** Increases **+2.59x** (0.90 ms $\rightarrow$ 2.33 ms mean, p95 3.00 ms).
- **GPU Frame Time:** Increases **+4.00x** (0.31 ms $\rightarrow$ 1.25 ms).
- **Draw Calls:** Increases **+2.13x** (223 $\rightarrow$ 474 draw calls), with 220 draw calls submitted for generated objects alone.
- **Dynamic Bus Uploads:** 87.4 KB of instance transform matrices packed and transferred to WebGL2 buffers on CPU every single frame.

### Comparative Measurements (`0xda55ffff`, Horizon View, Camera Pitch 0°)

The following data was captured using the non-interactive browser harness (`npm run harness:browser -- --gpu --profile-renderer ...`) with an identical camera position (`42087, 37.9, -16638.4`), orientation (yaw 0°, pitch 0°), and scene interest configuration:

| Measurement / Phase                   | Generated Layer OFF | Generated Layer ON     | Delta / Impact                                                                                           |
| :------------------------------------ | :------------------ | :--------------------- | :------------------------------------------------------------------------------------------------------- |
| **Mean CPU Frame Time**               | **0.903 ms**        | **2.330 ms**           | **+2.58x** (+1.43 ms)                                                                                    |
| - `generatedInstanceCullingMs`        | 0.000 ms            | 0.323 ms               | 🆕 Per-instance JS footprint testing                                                                     |
| - `instanceRunPreparationMs`          | 0.033 ms            | 0.338 ms               | **+10.24x** (+0.31 ms)                                                                                   |
| - `objectPreparationMs`               | 0.112 ms            | 0.350 ms               | **+3.13x** (+0.24 ms)                                                                                    |
| - `opaqueSubmissionMs`                | 0.277 ms            | 0.498 ms               | **+1.80x** (+0.22 ms)                                                                                    |
| - `sceneContributionResolutionMs`     | 0.127 ms            | 0.275 ms               | **+2.17x** (+0.15 ms)                                                                                    |
| - `sceneQueryMs`                      | 0.160 ms            | 0.202 ms               | **+1.26x** (+0.04 ms)                                                                                    |
| - `blendedOrderingMs`                 | 0.008 ms            | 0.053 ms               | **+6.63x** (+0.05 ms)                                                                                    |
| - `instanceUploadMs`                  | 0.003 ms            | 0.045 ms               | **+15.00x** (+0.04 ms)                                                                                   |
| - `terrainSubmissionMs`               | 0.087 ms            | 0.105 ms               | +0.02 ms                                                                                                 |
| - Other / Finalization                | 0.096 ms            | 0.141 ms               | +0.05 ms                                                                                                 |
| **Mean GPU Frame Time**               | **0.314 ms**        | **1.247 ms**           | **+3.97x** (+0.93 ms)                                                                                    |
| - GPU per-pass rows                   | —                   | —                      | superseded; see §1.1 — the original capture attributed the delta to `terrainMs`, which did not reproduce |
| - `ambientOcclusionMs`                | 0.114 ms            | 0.127 ms               | +0.01 ms                                                                                                 |
| - `blendedMs`                         | 0.008 ms            | 0.012 ms               | +0.004 ms                                                                                                |
| - `presentationMs`                    | 0.018 ms            | 0.025 ms               | +0.007 ms                                                                                                |
| **Active Scene Graph Static Objects** | 223                 | **1,003**              | **+4.50x** static objects evaluated                                                                      |
| **Tested Generated Instances**        | 0                   | **1,688** / frame      | 1,688 bounding boxes projected                                                                           |
| **Retained Generated Instances**      | 0                   | **706** (821 selected) | 982 culled / rejected                                                                                    |
| **Dynamic Instance Upload Bytes**     | 3.28 KB             | **87.44 KB** / frame   | **+26.66x** VBO stream traffic                                                                           |
| **Submitted Static Object Draws**     | 223                 | **474**                | **+2.13x** draw calls                                                                                    |
| - Compacted Generated Draws           | 0                   | **220**                | ~3.7 instances per draw call                                                                             |
| - Baked Static Draws                  | 223                 | **247**                | +24 baked units                                                                                          |
| - EnvCell Draws                       | 0                   | 7                      | Interior shells/residents                                                                                |
| **WebGL Texture Binds**               | 77                  | **144**                | **+1.87x** texture state churn                                                                           |
| **Shader Program Changes**            | 7                   | **26**                 | **+3.71x** pipeline switches                                                                             |
| **Lighting Group Binds**              | 7                   | **26**                 | **+3.71x** uniform uploads                                                                               |
| **Transparent Object Candidates**     | 9                   | **240**                | **+26.67x** alpha-tested tree foliage                                                                    |

### 1.1. Corrected GPU Pass Attribution (Re-measured 2026-08-18)

A repeat capture of the identical scenario (RX 7900 XT via ANGLE/Vulkan, 8 s measure window) reproduced the GPU _total_ but inverted the per-pass split:

| GPU Phase            | Generated Layer OFF | Generated Layer ON | Delta        |
| :------------------- | :------------------ | :----------------- | :----------- |
| `terrainMs`          | 0.053 ms            | 0.045 ms           | ~0           |
| `opaqueMs`           | 0.044 ms            | **1.414 ms**       | **+1.37 ms** |
| `ambientOcclusionMs` | 0.194 ms            | 0.188 ms           | ~0           |
| `blendedMs`          | 0.000 ms            | 0.018 ms           | +0.02 ms     |
| **Total**            | **0.329 ms**        | **1.722 ms**       | **+1.39 ms** |

This matches pass ordering: terrain draws _before_ opaque objects ([`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L2066-L2067)), so generated scenery cannot add depth complexity to the terrain pass. The original capture's `terrainMs` figure was a timer-window artifact: GPU spans are non-nesting `TIME_ELAPSED_EXT` windows and absorb whatever the GPU executes inside them. The added cost lives in the opaque pass, where the scenery actually draws.

---

## 2. Root Cause Analysis

### 2.1. Spatial Sub-Clustering & Scene Graph Bloat

- **Mechanism:** In [`static-object-geometry-worker.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts#L443-L470), each landblock subdivides its generated scenery into a 2x2 grid (`generatedSceneryClusterGridSize = 2`).
- **Effect:** Within each sub-cluster, every distinct mesh (tree models, bush models, rock variations) and material partition becomes its own [`StaticFragmentObject`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/systems/static-resources.ts).
- **Consequence:** Across 25 active landblocks, **525 individual static fragment objects** are registered into the spatial R-tree. Total active scene graph objects spike from 223 to 1,003, multiplying the workload across [`sceneQuery`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L1301) (0.20 ms), [`#resolveSceneContributions`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L1335) (0.28 ms), and `objectPreparationMs` (0.35 ms).

### 2.2. Per-Frame Narrow-Phase CPU Footprint Culling

- **Mechanism:** In [`generated-instance-selection.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts#L114-L150), [`GeneratedInstanceSelector.select`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts#L78) iterates every instance across visible streams (`testedGeneratedInstanceCount = 1,688`).
- **Effect:** For each instance, [`classifyObjectFootprint`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/object-footprint.ts) transforms the 8 bounding box corners against the camera's `clipFromAnchor` matrix to test against view frustum planes and screen pixel area (`minimumPixelArea = 64`).
- **Consequence:** 1,688 matrix-vector transformations and plane evaluations execute synchronously in JavaScript on the main render thread every frame (`generatedInstanceCullingMs = 0.323 ms`), lacking an early-accept / early-reject hierarchical broad phase.

### 2.3. Draw Call Fragmentation (220 Draws for 821 Instances)

- **Mechanism:** In [`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307-L3320), [`opaqueObjectInstanceBatchKey`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307) partitions instanced runs:
  ```ts
  `${object.ordering}\0${object.source}\0${object.renderScopeKey}\0${object.landblockId}\0${instances.cohortKey}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`;
  ```
- **Effect:**
  1. **`landblockId` is in the batch key:** Instances of the identical tree model on neighboring landblocks cannot share an instanced draw call.
  2. **`cohortKey` embeds the 2x2 cluster key:** Within a single landblock, identical trees in adjacent clusters cannot merge either.
- **Consequence:** A single common tree model across a 5x5 landblock neighborhood is fragmented across up to 100 separate draw calls. Total generated draw calls reach **220** for only **821 rendered instances** (averaging ~3.7 instances per draw call).

### 2.4. CPU Compaction & Dynamic Buffer Upload Churn

- **Mechanism:** In [`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L2868-L2946), `#prepareObjectInstanceRuns` iterates all retained instances across the 220 runs, populates an array of records, and calls `#frameInstances.prepareView()`.
- **Effect:** 87.4 KB of instance transform matrices (16 floats per instance record) are re-encoded and uploaded across the PCIe/GPU bus every single frame.
- **Consequence:** CPU compaction and staging overhead (`instanceRunPreparationMs = 0.338 ms`, `instanceUploadMs = 0.045 ms`) consume substantial CPU frame time for static, unchanging scenery.

### 2.5. WebGL State Churn

- **Mechanism:** Draw units are dispatched in scene graph / spatial order rather than sorted by state key `(program, textureAtlas, lightingGroup)`.
- **Effect:** WebGL state changes multiply:
  - Texture binds increase from 77 to 144.
  - Shader program switches increase from 7 to 26.
  - Lighting uniform block binds increase from 7 to 26.
- **Consequence:** Driver and JavaScript submission overhead causes `opaqueSubmissionMs` to rise from 0.28 ms to 0.50 ms.

### 2.6. GPU Cost Is Submission-Bound, Not Fill-Bound (Revised)

- **Where the time goes:** The corrected capture (§1.1) places the entire GPU delta in the opaque pass (+1.37 ms), where the 220 generated instanced draws execute.
- **Fillrate ruled out:** ~89k triangles of low-resolution, alpha-tested foliage cannot account for 1.4 ms on an RX 7900 XT; fill and vertex cost at this content density is negligible on any modern adapter. The elapsed-time window instead absorbs the per-draw pipeline overhead of 220 small instanced draws with 26 program switches and 144 texture binds (§2.3, §2.5).
- **Transparency footnote:** `transparentObjectCandidateCount` rises 9 → 240, but `blendedMs` stays ~0.02 ms; distant transparent objects are grouped rather than depth-sorted ([`orderTransparentObjectRanges`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts#L216-L237)). Foliage transparency is not a material cost at this radius.
- **Implication:** Draw-call collapse is a GPU remediation as much as a CPU one.

### 2.7. V8 Sampling-Profile Attribution (Added 2026-08-18)

Function-level self-time from the harness's Chrome DevTools profiler (`--cpu-profile`, 100 µs sampling, 8 s steady-state window, generated layer ON vs OFF) corroborates §2.1–2.5 and surfaces two costs the phase buckets hide:

| Cost Theme                            | Δ Self-Time (8 s window) | Functions                                                                                                |
| :------------------------------------ | :----------------------- | :------------------------------------------------------------------------------------------------------- |
| Narrow-phase footprint culling        | **+937 ms**              | `classifyObjectFootprint`, `GeneratedInstanceSelector.select`                                            |
| Run-grouping machinery                | **+511 ms**              | `formGroupedObjectInstanceRuns`                                                                          |
| Per-draw instance-attribute rebinding | **+364 ms**              | `vertexAttribPointer`, `enableVertexAttribArray`, `vertexAttribDivisor`, `bindWebGL2ObjectInstanceRange` |
| Per-object frame preparation          | **+407 ms**              | `#prepareObjectFrameInput`, `resolveStaticObjectNode`, `getLandblockCoordinates`                         |

(The ON run rendered ~2.5x fewer frames in the same wall-clock window, so per-frame ratios are steeper than the raw deltas.)

- **Bucket leakage:** Culling cost exceeds the `generatedInstanceCullingMs` bucket because `GeneratedInstanceSelector.select` cache misses also execute inside the run-assembly loop ([`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L2899)) and are billed to `instanceRunPreparationMs`. Total selection cost is roughly double what the culling bucket reports.
- **Grouping is a first-class cost:** `formGroupedObjectInstanceRuns` is the second-largest hotspot. Building the `\0`-joined batch-key string per object per frame (§2.3) and grouping through a map is itself expensive and is the likely source of the observed GC delta (+52 ms). Shrinking the _key_ does not remove this; only shrinking the _object count_ does.
- **Rebinding tax:** Each of the 220 instanced draws re-points the instance attribute stream, so draw fragmentation is paid a second time at submission, independent of state sorting (§2.5).

---

## 3. Potential Architectural Solutions

### Option A: Static Baking (Recommended)

Mirror the approach used for `LandblockLayerKind.Buildings` and `LandblockLayerKind.Objects` by baking generated scenery into per-landblock static vertex/index buffers via [`prepareBakedStaticObjectGeometry`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts#L168).

- **Pros:**
  - **Zero CPU culling cost:** Eliminates the full selection cost — both the `generatedInstanceCullingMs` bucket and the cache-miss selection billed to `instanceRunPreparationMs` (§2.7).
  - **Zero per-frame instance compaction & upload:** Eliminates `instanceRunPreparationMs` and 87 KB/frame dynamic buffer upload.
  - **Eliminates the grouping machinery:** Baked draws never pass through `formGroupedObjectInstanceRuns`, removing the per-object batch-key construction that profiling identified as the second-largest hotspot (§2.7), along with its GC churn.
  - **Eliminates per-draw instance rebinding:** Baked draws carry no instance attribute stream, removing the rebinding tax (§2.7).
  - **Draw call collapse:** Merges 220 generated draws into ~20–30 per-landblock baked draws. Per §2.6, this is also the primary GPU remediation: the +1.37 ms opaque-pass delta is submission-bound, not fill-bound.
  - **Scene graph reduction:** Reduces static objects from 1,003 to ~250.
- **Cons:**
  - **VRAM consumption:** 821 trees and rocks across 25 landblocks amount to ~89,000 triangles (~2.0 MB VBO memory), which is negligible on modern hardware.
  - **Loses the per-instance pixel-area cull:** All instances in a resident landblock are vertex-shaded whenever the landblock is in frustum. This is bounded and acceptable because the generated radius is capped at 2 (retail used 1); it would need revisiting only if the radius policy changed.
  - **Streaming bake cost is unmeasured:** Baking moves work from per-frame to per-residency-change. The Explorer has no follow mode yet, so worker bake latency and commit hitching while crossing landblock boundaries have never been observed. Measure a relocation sweep (`--relocate-landblock`) before and after adopting this option; the existing building bake path pays the same toll and sets the baseline.

All four cost themes in §2.7 scale with per-frame object and instance count, which baking removes wholesale. This is the structural argument for Option A over Option B: Option B's batch-key surgery collapses draw calls but still walks every object and instance per frame.

---

### Option B: Unified Global Instancing with Broad-Phase Culling

Retain instancing but address structural fragmentation. Per §2.7 this remains a partial remediation: per-object batch-key construction, per-instance selection, and per-object frame preparation persist, shrunk but not removed. Its structural advantage — per-instance culling and shared geometry — only pays off if the generated radius grows well beyond 2, which is not the current policy (retail used radius 1).

1. **Anchor-Relative Instance Transforms:** Store instance transforms relative to the scene anchor or include the landblock offset within the per-instance vertex attribute/SSBO. Remove `landblockId` and `clusterKey` from [`opaqueObjectInstanceBatchKey`](file:///home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307).
   - _Impact:_ Collapses 220 draw calls down to 5–10 draw calls across the entire view.
2. **Hierarchical Broad-Phase Frustum Culling:**
   - If a cluster bounding box is fully inside the frustum and above the pixel threshold, accept all instances in one operation without per-instance projection.
   - If a cluster bounding box is outside or sub-pixel, reject all instances immediately.
   - Only evaluate the narrow-phase loop on boundary clusters.
3. **State Sorting:** Bucket draw calls by `(program, textureAtlasPage, lightingGroup)` before submission to minimize WebGL pipeline switches.
