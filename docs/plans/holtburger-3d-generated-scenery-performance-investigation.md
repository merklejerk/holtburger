# Investigation: Generated Scenery Layer Performance Impact

This document details the CPU and GPU performance analysis of the generated scenery/objects static layer in [`apps/holtburger-3d`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d). It captures profiler evidence gathered on outdoor landblock `0xda55ffff` looking out across the horizon, isolates each contributing mechanism in the runtime and renderer, and evaluates remediation paths.

---

## 1. Executive Summary & Profiler Evidence

Enabling the generated scenery layer across standard Explorer residency radii (terrain/buildings: 8, generated: 2) results in:
- **CPU Frame Time:** Increases **+2.59x** (0.90 ms $\rightarrow$ 2.33 ms mean, p95 3.00 ms).
- **GPU Frame Time:** Increases **+4.00x** (0.31 ms $\rightarrow$ 1.25 ms).
- **Draw Calls:** Increases **+2.13x** (223 $\rightarrow$ 474 draw calls), with 220 draw calls submitted for generated objects alone.
- **Dynamic Bus Uploads:** 87.4 KB of instance transform matrices packed and transferred to WebGL2 buffers on CPU every single frame.

### Comparative Measurements (`0xda55ffff`, Horizon View, Camera Pitch 0°)

The following data was captured using the non-interactive browser harness (`npm run harness:browser -- --gpu --profile-renderer ...`) with an identical camera position (`42087, 37.9, -16638.4`), orientation (yaw 0°, pitch 0°), and scene interest configuration:

| Measurement / Phase | Generated Layer OFF | Generated Layer ON | Delta / Impact |
| :--- | :--- | :--- | :--- |
| **Mean CPU Frame Time** | **0.903 ms** | **2.330 ms** | **+2.58x** (+1.43 ms) |
| - `generatedInstanceCullingMs` | 0.000 ms | 0.323 ms | 🆕 Per-instance JS footprint testing |
| - `instanceRunPreparationMs` | 0.033 ms | 0.338 ms | **+10.24x** (+0.31 ms) |
| - `objectPreparationMs` | 0.112 ms | 0.350 ms | **+3.13x** (+0.24 ms) |
| - `opaqueSubmissionMs` | 0.277 ms | 0.498 ms | **+1.80x** (+0.22 ms) |
| - `sceneContributionResolutionMs` | 0.127 ms | 0.275 ms | **+2.17x** (+0.15 ms) |
| - `sceneQueryMs` | 0.160 ms | 0.202 ms | **+1.26x** (+0.04 ms) |
| - `blendedOrderingMs` | 0.008 ms | 0.053 ms | **+6.63x** (+0.05 ms) |
| - `instanceUploadMs` | 0.003 ms | 0.045 ms | **+15.00x** (+0.04 ms) |
| - `terrainSubmissionMs` | 0.087 ms | 0.105 ms | +0.02 ms |
| - Other / Finalization | 0.096 ms | 0.141 ms | +0.05 ms |
| **Mean GPU Frame Time** | **0.314 ms** | **1.247 ms** | **+3.97x** (+0.93 ms) |
| - `terrainMs` | 0.130 ms | 0.980 ms | +0.85 ms (overdraw / depth complexity) |
| - `ambientOcclusionMs` | 0.114 ms | 0.127 ms | +0.01 ms |
| - `opaqueMs` | 0.034 ms | 0.096 ms | **+2.82x** (+0.06 ms) |
| - `blendedMs` | 0.008 ms | 0.012 ms | +0.004 ms |
| - `presentationMs` | 0.018 ms | 0.025 ms | +0.007 ms |
| **Active Scene Graph Static Objects** | 223 | **1,003** | **+4.50x** static objects evaluated |
| **Tested Generated Instances** | 0 | **1,688** / frame | 1,688 bounding boxes projected |
| **Retained Generated Instances** | 0 | **706** (821 selected) | 982 culled / rejected |
| **Dynamic Instance Upload Bytes** | 3.28 KB | **87.44 KB** / frame | **+26.66x** VBO stream traffic |
| **Submitted Static Object Draws** | 223 | **474** | **+2.13x** draw calls |
| - Compacted Generated Draws | 0 | **220** | ~3.7 instances per draw call |
| - Baked Static Draws | 223 | **247** | +24 baked units |
| - EnvCell Draws | 0 | 7 | Interior shells/residents |
| **WebGL Texture Binds** | 77 | **144** | **+1.87x** texture state churn |
| **Shader Program Changes** | 7 | **26** | **+3.71x** pipeline switches |
| **Lighting Group Binds** | 7 | **26** | **+3.71x** uniform uploads |
| **Transparent Object Candidates** | 9 | **240** | **+26.67x** alpha-tested tree foliage |

---

## 2. Root Cause Analysis

### 2.1. Spatial Sub-Clustering & Scene Graph Bloat
- **Mechanism:** In [`static-object-geometry-worker.ts`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts#L443-L470), each landblock subdivides its generated scenery into a 2x2 grid (`generatedSceneryClusterGridSize = 2`).
- **Effect:** Within each sub-cluster, every distinct mesh (tree models, bush models, rock variations) and material partition becomes its own [`StaticFragmentObject`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/systems/static-resources.ts).
- **Consequence:** Across 25 active landblocks, **525 individual static fragment objects** are registered into the spatial R-tree. Total active scene graph objects spike from 223 to 1,003, multiplying the workload across [`sceneQuery`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L1301) (0.20 ms), [`#resolveSceneContributions`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L1335) (0.28 ms), and `objectPreparationMs` (0.35 ms).

### 2.2. Per-Frame Narrow-Phase CPU Footprint Culling
- **Mechanism:** In [`generated-instance-selection.ts`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts#L114-L150), [`GeneratedInstanceSelector.select`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts#L78) iterates every instance across visible streams (`testedGeneratedInstanceCount = 1,688`).
- **Effect:** For each instance, [`classifyObjectFootprint`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/object-footprint.ts) transforms the 8 bounding box corners against the camera's `clipFromAnchor` matrix to test against view frustum planes and screen pixel area (`minimumPixelArea = 64`).
- **Consequence:** 1,688 matrix-vector transformations and plane evaluations execute synchronously in JavaScript on the main render thread every frame (`generatedInstanceCullingMs = 0.323 ms`), lacking an early-accept / early-reject hierarchical broad phase.

### 2.3. Draw Call Fragmentation (220 Draws for 821 Instances)
- **Mechanism:** In [`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307-L3320), [`opaqueObjectInstanceBatchKey`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307) partitions instanced runs:
  ```ts
  `${object.ordering}\0${object.source}\0${object.renderScopeKey}\0${object.landblockId}\0${instances.cohortKey}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`
  ```
- **Effect:**
  1. **`landblockId` is in the batch key:** Instances of the identical tree model on neighboring landblocks cannot share an instanced draw call.
  2. **`cohortKey` embeds the 2x2 cluster key:** Within a single landblock, identical trees in adjacent clusters cannot merge either.
- **Consequence:** A single common tree model across a 5x5 landblock neighborhood is fragmented across up to 100 separate draw calls. Total generated draw calls reach **220** for only **821 rendered instances** (averaging ~3.7 instances per draw call).

### 2.4. CPU Compaction & Dynamic Buffer Upload Churn
- **Mechanism:** In [`webgl2-renderer.ts`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L2868-L2946), `#prepareObjectInstanceRuns` iterates all retained instances across the 220 runs, populates an array of records, and calls `#frameInstances.prepareView()`.
- **Effect:** 87.4 KB of instance transform matrices (16 floats per instance record) are re-encoded and uploaded across the PCIe/GPU bus every single frame.
- **Consequence:** CPU compaction and staging overhead (`instanceRunPreparationMs = 0.338 ms`, `instanceUploadMs = 0.045 ms`) consume substantial CPU frame time for static, unchanging scenery.

### 2.5. WebGL State Churn
- **Mechanism:** Draw units are dispatched in scene graph / spatial order rather than sorted by state key `(program, textureAtlas, lightingGroup)`.
- **Effect:** WebGL state changes multiply:
  - Texture binds increase from 77 to 144.
  - Shader program switches increase from 7 to 26.
  - Lighting uniform block binds increase from 7 to 26.
- **Consequence:** Driver and JavaScript submission overhead causes `opaqueSubmissionMs` to rise from 0.28 ms to 0.50 ms.

### 2.6. Transparency & GPU Overdraw
- **Foliage Alpha:** Shipped tree and shrub models author transparent canopies, causing `transparentObjectCandidateCount` to jump from 9 to 240.
- **Depth Sorting Cost:** `blendedOrderingMs` is low (0.053 ms) because distant transparent objects are grouped rather than depth-sorted ([`orderTransparentObjectRanges`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts#L216-L237)).
- **GPU Fillrate:** GPU time rises from 0.31 ms to 1.25 ms, primarily due to increased vertex transformation and alpha-tested pixel shader invocations on overlapping foliage layers.

---

## 3. Potential Architectural Solutions

### Option A: Static Baking (Recommended)
Mirror the approach used for `LandblockLayerKind.Buildings` and `LandblockLayerKind.Objects` by baking generated scenery into per-landblock static vertex/index buffers via [`prepareBakedStaticObjectGeometry`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts#L168).

- **Pros:**
  - **Zero CPU culling cost:** Eliminates `generatedInstanceCullingMs` (0.32 ms $\rightarrow$ 0 ms).
  - **Zero per-frame instance compaction & upload:** Eliminates `instanceRunPreparationMs` and 87 KB/frame dynamic buffer upload (0.38 ms $\rightarrow$ 0 ms).
  - **Draw call collapse:** Merges 220 generated draws into ~20–30 per-landblock baked draws.
  - **Scene graph reduction:** Reduces static objects from 1,003 to ~250.
- **Cons:**
  - **VRAM consumption:** 821 trees and rocks across 25 landblocks amount to ~89,000 triangles (~2.0 MB VBO memory), which is negligible on modern hardware.

---

### Option B: Unified Global Instancing with Broad-Phase Culling
Retain instancing but address structural fragmentation:

1. **Anchor-Relative Instance Transforms:** Store instance transforms relative to the scene anchor or include the landblock offset within the per-instance vertex attribute/SSBO. Remove `landblockId` and `clusterKey` from [`opaqueObjectInstanceBatchKey`](file:///home/cluracan/code/holtburger/.worktrees/claude/apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts#L3307).
   - *Impact:* Collapses 220 draw calls down to 5–10 draw calls across the entire view.
2. **Hierarchical Broad-Phase Frustum Culling:**
   - If a cluster bounding box is fully inside the frustum and above the pixel threshold, accept all instances in one operation without per-instance projection.
   - If a cluster bounding box is outside or sub-pixel, reject all instances immediately.
   - Only evaluate the narrow-phase loop on boundary clusters.
3. **State Sorting:** Bucket draw calls by `(program, textureAtlasPage, lightingGroup)` before submission to minimize WebGL pipeline switches.
