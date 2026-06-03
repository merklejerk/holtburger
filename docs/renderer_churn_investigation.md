# Investigation of Rendering Pipeline Churn & Frame Drops

This document provides a detailed technical analysis of the CPU and GPU resource synchronization mechanisms in [holtburger-3d](file:///home/me/code/holtburger/apps/holtburger-3d). It isolates the exact execution paths, data allocations, and matrix calculations that cause the main thread to freeze and drop frames when a landblock loads.

---

## 1. Global Sync Trigger and Lack of Incrementalism

In [webgl2-world-display-renderer-impl.ts](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts), any change in scene state or asset readiness triggers a global synchronization cycle:

1. **State Updates**: Handlers like `setAssetState`, `setTerrainScene`, `setStaticRenderableScene`, and `setRenderChunkTransforms` set the boolean `worldResourcesDirty = true` and call `scheduleFrame()`.
2. **Reconciliation**: On the next frame, the renderer calls [syncWorldResources](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts#L2248).
3. **Lack of Chunk Partitioning**: There is no spatial boundaries or incremental tracking in this sync loop. When a new landblock is loaded, the entire scene's static assets are flagged as dirty, causing the pipeline to re-stage, re-bake, and re-hash **all static geometries** across all active landblocks in view.

---

## 2. Main-Thread Staging & Vertex Transformation #1

The first CPU-side bottleneck occurs during the staging phase inside [staged-world-assembly.ts](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/staged-world-assembly.ts):

1. **Scene Assembly**: `syncWorldResources` calls [buildStagedWorldSceneAssembly](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/staged-world-assembly.ts#L153).
2. **Static Objects Resolution**: This delegates to `buildStagedStaticDrawUnitAssemblies`, which groups all committed static models by their chunk partition coordinates.
3. **Vertex Transformation Loop**: For every static part, it calls [buildStagedStaticPartGeometry](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/staged-world-assembly.ts#L961). Here, the CPU performs the following synchronous operations:
   * **Allocation**: Allocates a new `Float32Array` matching the source geometry vertex count:
     ```typescript
     const positions = new Float32Array(geometry.positions.length);
     for (
         let vertexIndex = 0;
         vertexIndex < geometry.vertexCount;
         vertexIndex += 1
     ) {
         transformPosition(
             positions,
             vertexIndex,
             geometry.positions,
             vertexIndex,
             matrix,
         );
     }
     ```
   * **Result**: This returns a new `StagedWorldIndexedGeometry` structure with CPU-allocated vertex and UV arrays.

---

## 3. Geometry Compaction & Vertex Transformation #2

Once the scene assembly is built, the renderer processes the static geometries through the compaction pipeline to merge draw calls. This happens inside [compacted-geometry-sync.ts](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/webgl2/resources/compacted-geometry-sync.ts):

1. **Partitioning**: `syncWebgl2CompactedGeometryResources` retrieves the compaction plan for static draw units.
2. **Batch Planning**: It calls `createRgbaTexturePageCompactedLandblockBatchPlans` to group draw units by their owning `landblockId`.
3. **Compaction Math Loop**: For *every* batch plan (meaning every active landblock), it calls [buildCompactedGeometryBatch](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/compaction/compacted-geometry.ts#L71). Inside this function, the CPU executes the following:
   * **Large Allocations**: Computes the total vertex and index count across all draw units in the batch, and allocates new contiguous arrays:
     ```typescript
     const positions = new Float32Array(vertexCount * 3);
     const uvs = new Float32Array(vertexCount * 2);
     const materialSlotIndices = new Float32Array(vertexCount);
     const indices = createCompactedIndexArray(vertexCount, indexCount);
     ```
   * **Transformation Loop #2**: Loops through every draw unit in the batch and performs a *second* coordinate transformation loop, multiplying the already-transformed staged positions by the draw unit's relative model matrix to align them to the batch's origin:
     ```typescript
     compactDrawUnitPositions({
         target: positions,
         targetVertexOffset: vertexOffset,
         source: drawUnit.geometry.positions,
         modelMatrix: drawUnit.modelMatrix,
         batchOrigin,
     });
     ```
   * **Memory Copying**: Copies UV coordinates (`uvs.set`) and calculates offset index pointers for the element buffer.

---

## 4. The Cache Key Paradox

To check if the compiled compaction geometry can reuse a WebGL buffer resource on the GPU, the pipeline calls `retainWebgl2CompactedGeometryBatch`. This queries [describeCompactedGeometryKey](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/compaction/compacted-geometry.ts#L395):

```typescript
function describeCompactedGeometryKey({
    plan,
    drawUnits,
    positions,
}: {
    plan: CompactedGeometryPlan;
    drawUnits: readonly StagedWorldDrawUnitAssembly[];
    positions: Float32Array;
}): string {
    const drawUnitSignature = drawUnits
        .map((drawUnit) =>
            [
                drawUnit.id,
                `v${drawUnit.geometry.vertexCount}`,
                `t${drawUnit.geometry.triangleCount}`,
                `u${hashFloat32Array(drawUnit.geometry.uvs ?? new Float32Array())}`,
                `i${hashIndexArray(drawUnit.geometry.indices)}`,
            ].join(":"),
        )
        .join("|");
    return [
        "compacted-geometry",
        `plan=${hashString(plan.key)}`,
        `bp${hashFloat32Array(positions)}`, // <--- Hashing the massive generated array!
        `draws=${drawUnits.length}`,
        `du=${hashString(drawUnitSignature)}`,
    ].join("|");
}
```

* **The Inefficiency**: The cache key contains `bp${hashFloat32Array(positions)}`. 
* **The Consequence**: Because the cache key relies on the hash of the *fully computed vertex position array*, the CPU is forced to execute all allocations, staging, and compaction transformations for **every** landblock in the scene, and then hash megabytes of float data, just to determine if it can skip uploading the buffer to the GPU.
* **Cache Bypass**: If the cache hits, the WebGL buffer upload is skipped, but the CPU-side math loop (the staging, double-transformation, and array allocations) has already been fully executed on the main thread for all landblocks.

---

## 5. Main-Thread Texture Atlas Assembly & WebGL Uploads

In [texture-atlas-generation.ts](file:///home/me/code/holtburger/apps/holtburger-3d/src/lib/world-display/webgl2/resources/texture-atlas-generation.ts), the compilation of texture resources also occurs synchronously:

1. **CPU Image Blitting**: When a plan changes, `createWebgl2TextureAtlasGenerationResource` allocates a large CPU pixel array:
   ```typescript
   const pixels = new Uint8Array(page.width * page.height * 4);
   ```
   It then runs a CPU-bound pixel copying loop (`copyTextureAtlasPlacement`) to copy sub-rectangles from individual textures into this unified buffer.
2. **Buffer Upload**: Uploads the complete texture atlas sheet to the GPU via `gl.texImage2D`.
3. **Pipeline Stall**: Invokes `gl.generateMipmap(gl.TEXTURE_2D)` on the newly uploaded texture sheet. For 2K or 4K textures, this causes a major CPU/GPU pipeline block, forcing the main thread to stall while the GPU computes the mip levels.
