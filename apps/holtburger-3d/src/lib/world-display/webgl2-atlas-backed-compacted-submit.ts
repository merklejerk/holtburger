import type { RenderMat4 } from "./render-math";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2AtlasBackedCompactedBatchResource } from "./webgl2-atlas-backed-compacted-batches";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";

export const WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS = 128;

export type Webgl2AtlasBackedCompactedWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "materialSlot",
	| "uViewProjection"
	| "uBatchModel"
	| "uAtlasTexture"
	| "uAtlasSize"
	| "uDetailAtlasTexture"
	| "uDetailAtlasSize"
	| "uMaterialRects"
	| "uMaterialWrapModes"
	| "uDetailMaterialRects"
	| "uDetailMaterialTilings"
	| "uDetailMaterialEnabled"
>;

export interface Webgl2AtlasBackedCompactedSubmitMetrics {
	shaderDrawCallCount: number;
	submittedBatchCount: number;
	submittedDrawSliceCount: number;
	submittedTriangleCount: number;
	submittedSliceRepresentedDrawUnitCount: number;
	replacedDrawUnitCount: number;
	retainedDrawUnitCount: number;
	noVisibleRouteCount: number;
	fallbackSamples: readonly string[];
}

export interface Webgl2AtlasBackedCompactedSubmitResources {
	batches: readonly Webgl2AtlasBackedCompactedBatchResource[];
	generation: Webgl2TextureAtlasGenerationResource | null;
}

export function createEmptyWebgl2AtlasBackedCompactedSubmitMetrics(): Webgl2AtlasBackedCompactedSubmitMetrics {
	return {
		shaderDrawCallCount: 0,
		submittedBatchCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
		submittedSliceRepresentedDrawUnitCount: 0,
		replacedDrawUnitCount: 0,
		retainedDrawUnitCount: 0,
		noVisibleRouteCount: 0,
		fallbackSamples: [],
	};
}

export function planWebgl2AtlasBackedCompactedReplacement(options: {
	visibleDrawUnitIds: readonly string[];
	resources: Webgl2AtlasBackedCompactedSubmitResources;
}): {
	replaceableDrawUnitIds: ReadonlySet<string>;
	noVisibleRouteCount: number;
	fallbackSamples: readonly string[];
} {
	if (!options.resources.generation) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: ["atlas-backed compacted submit missing atlas generation"],
		};
	}
	if (options.resources.batches.length === 0) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: ["atlas-backed compacted submit missing compacted batches"],
		};
	}
	for (const batch of options.resources.batches) {
		if (batch.materialSlots.length > WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS) {
			return {
				replaceableDrawUnitIds: new Set(),
				noVisibleRouteCount: 0,
				fallbackSamples: [
					`atlas-backed compacted submit material slots ${batch.materialSlots.length} exceed ${WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS}`,
				],
			};
		}
	}
	const visibleIds = new Set(options.visibleDrawUnitIds);
	const replaceableDrawUnitIds = new Set<string>();
	let noVisibleRouteCount = 0;
	for (const batch of options.resources.batches) {
		const batchVisibleDrawUnitIds = batch.drawSlices.flatMap((slice) =>
			slice.drawUnitIds.filter((drawUnitId) => visibleIds.has(drawUnitId)),
		);
		if (batchVisibleDrawUnitIds.length === 0) {
			noVisibleRouteCount += 1;
			continue;
		}
		for (const drawUnitId of batchVisibleDrawUnitIds) {
			replaceableDrawUnitIds.add(drawUnitId);
		}
	}
	if (replaceableDrawUnitIds.size === 0) {
		return {
			replaceableDrawUnitIds,
			noVisibleRouteCount,
			fallbackSamples: [],
		};
	}
	return {
		replaceableDrawUnitIds,
		noVisibleRouteCount,
		fallbackSamples: [],
	};
}

export function submitWebgl2AtlasBackedCompactedBatch({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	resources,
	replaceableDrawUnitIds,
	retainedDrawUnitCount,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2AtlasBackedCompactedWorldProgram;
	viewProjectionMatrix: RenderMat4;
	resources: {
		batches: readonly Webgl2AtlasBackedCompactedBatchResource[];
		generation: Webgl2TextureAtlasGenerationResource;
	};
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
}): Webgl2AtlasBackedCompactedSubmitMetrics {
	if (replaceableDrawUnitIds.size === 0) {
		return {
			...createEmptyWebgl2AtlasBackedCompactedSubmitMetrics(),
			retainedDrawUnitCount,
		};
	}
	const metrics: Webgl2AtlasBackedCompactedSubmitMetrics = {
		shaderDrawCallCount: 0,
		submittedBatchCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
		submittedSliceRepresentedDrawUnitCount: 0,
		replacedDrawUnitCount: replaceableDrawUnitIds.size,
		retainedDrawUnitCount,
		noVisibleRouteCount: 0,
		fallbackSamples: [],
	};
	if (stateCache.useProgram(program.program)) {
		metrics.shaderDrawCallCount += 0;
	}
	metrics.shaderDrawCallCount += 0;
	gl.uniform1i(program.uniforms.uAtlasTexture, 0);
	gl.uniform1i(program.uniforms.uDetailAtlasTexture, 1);
	gl.uniformMatrix4fv(
		program.uniforms.uViewProjection,
		false,
		viewProjectionMatrix,
	);
	for (const batch of resources.batches) {
		const visibleSlices = batch.drawSlices.filter((slice) =>
			slice.drawUnitIds.some((drawUnitId) =>
				replaceableDrawUnitIds.has(drawUnitId),
			),
		);
		if (visibleSlices.length === 0) {
			continue;
		}
		metrics.submittedBatchCount += 1;
		gl.uniformMatrix4fv(
			program.uniforms.uBatchModel,
			false,
			batch.batchModelMatrix,
		);
		uploadAtlasBackedCompactedMaterialRects(gl, program, batch);
		if (stateCache.bindVertexArray(batch.vertexArray.vertexArray)) {
			metrics.shaderDrawCallCount += 0;
		}
		for (const slice of visibleSlices) {
			const texture = resources.generation.textures.find(
				(candidate) => candidate.textureIndex === slice.atlasTextureIndex,
			);
			if (!texture) {
				metrics.fallbackSamples = [
					...metrics.fallbackSamples,
					`atlas-backed compacted draw slice ${slice.key} missing atlas texture ${slice.atlasTextureIndex}`,
				].slice(0, 8);
				continue;
			}
			if (stateCache.bindTexture2D(0, texture.texture.texture)) {
				// Counted as a state change in the aggregate submit path by callers.
			}
			const detailTexture = slice.detailAtlasTextureIndex == null
				? null
				: (resources.generation.detailTextures ?? []).find(
						(candidate) =>
							candidate.textureIndex === slice.detailAtlasTextureIndex,
					);
			if (slice.detailAtlasTextureIndex != null && !detailTexture) {
				metrics.fallbackSamples = [
					...metrics.fallbackSamples,
					`atlas-backed compacted draw slice ${slice.key} missing detail atlas texture ${slice.detailAtlasTextureIndex}`,
				].slice(0, 8);
				continue;
			}
			if (detailTexture && stateCache.bindTexture2D(1, detailTexture.texture.texture)) {
				// Counted as a state change in the aggregate submit path by callers.
			}
			gl.uniform2f(program.uniforms.uAtlasSize, texture.width, texture.height);
			gl.uniform2f(
				program.uniforms.uDetailAtlasSize,
				detailTexture?.width ?? 1,
				detailTexture?.height ?? 1,
			);
			gl.drawElements(
				gl.TRIANGLES,
				slice.indexCount,
				batch.indexType,
				slice.firstIndex * indexTypeByteLength(gl, batch.indexType),
			);
			metrics.shaderDrawCallCount += 1;
			metrics.submittedDrawSliceCount += 1;
			metrics.submittedTriangleCount += slice.indexCount / 3;
			metrics.submittedSliceRepresentedDrawUnitCount +=
				slice.drawUnitIds.length;
		}
	}
	return metrics;
}

function uploadAtlasBackedCompactedMaterialRects(
	gl: WebGL2RenderingContext,
	program: Webgl2AtlasBackedCompactedWorldProgram,
	batch: Webgl2AtlasBackedCompactedBatchResource,
): void {
	const rects = new Float32Array(WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS * 4);
	const detailRects = new Float32Array(
		WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS * 4,
	);
	const wrapModes = new Int32Array(
		WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS * 2,
	);
	const detailTilings = new Float32Array(WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS);
	const detailEnabled = new Int32Array(WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS);
	for (const slot of batch.materialSlots) {
		rects.set(slot.atlasRect, slot.index * 4);
		wrapModes.set(
			[slot.wrapS === "repeat" ? 1 : 0, slot.wrapT === "repeat" ? 1 : 0],
			slot.index * 2,
		);
		detailRects.set(slot.detailAtlasRect ?? [0, 0, 1, 1], slot.index * 4);
		detailTilings[slot.index] = slot.detailTiling ?? 1;
		detailEnabled[slot.index] = slot.detailAtlasTextureIndex == null ? 0 : 1;
	}
	gl.uniform4fv(program.uniforms.uMaterialRects, rects);
	gl.uniform2iv(program.uniforms.uMaterialWrapModes, wrapModes);
	gl.uniform4fv(program.uniforms.uDetailMaterialRects, detailRects);
	gl.uniform1fv(program.uniforms.uDetailMaterialTilings, detailTilings);
	gl.uniform1iv(program.uniforms.uDetailMaterialEnabled, detailEnabled);
}

function indexTypeByteLength(
	gl: WebGL2RenderingContext,
	indexType: GLenum,
): number {
	if (indexType === gl.UNSIGNED_SHORT) {
		return 2;
	}
	if (indexType === gl.UNSIGNED_INT) {
		return 4;
	}
	throw new Error(`Unsupported atlas-backed compacted index type ${indexType}.`);
}
