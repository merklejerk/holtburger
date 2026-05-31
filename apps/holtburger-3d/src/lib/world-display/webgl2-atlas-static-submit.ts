import type { RenderMat4 } from "./render-math";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2AtlasStaticBatchResource } from "./webgl2-atlas-static-batches";
import type { Webgl2AtlasStaticGenerationResource } from "./webgl2-atlas-static-generation";

export const WEBGL2_ATLAS_STATIC_MAX_MATERIAL_SLOTS = 128;

export type Webgl2AtlasStaticWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "materialSlot",
	| "uViewProjection"
	| "uBatchModel"
	| "uAtlasTexture"
	| "uAtlasSize"
	| "uMaterialRects"
>;

export interface Webgl2AtlasStaticSubmitMetrics {
	shaderDrawCallCount: number;
	submittedDrawSliceCount: number;
	submittedTriangleCount: number;
	replacedDrawUnitCount: number;
	retainedDrawUnitCount: number;
	noVisibleRouteCount: number;
	fallbackSamples: readonly string[];
}

export interface Webgl2AtlasStaticSubmitResources {
	batch: Webgl2AtlasStaticBatchResource | null;
	generation: Webgl2AtlasStaticGenerationResource | null;
}

export function createEmptyWebgl2AtlasStaticSubmitMetrics(): Webgl2AtlasStaticSubmitMetrics {
	return {
		shaderDrawCallCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
		replacedDrawUnitCount: 0,
		retainedDrawUnitCount: 0,
		noVisibleRouteCount: 0,
		fallbackSamples: [],
	};
}

export function planWebgl2AtlasStaticReplacement(options: {
	visibleDrawUnitIds: readonly string[];
	resources: Webgl2AtlasStaticSubmitResources;
}): {
	replaceableDrawUnitIds: ReadonlySet<string>;
	noVisibleRouteCount: number;
	fallbackSamples: readonly string[];
} {
	if (!options.resources.generation) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: ["atlas static submit missing atlas generation"],
		};
	}
	if (!options.resources.batch) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: ["atlas static submit missing compacted batch"],
		};
	}
	if (
		options.resources.batch.materialSlots.length >
		WEBGL2_ATLAS_STATIC_MAX_MATERIAL_SLOTS
	) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: [
				`atlas static submit material slots ${options.resources.batch.materialSlots.length} exceed ${WEBGL2_ATLAS_STATIC_MAX_MATERIAL_SLOTS}`,
			],
		};
	}
	const visibleIds = new Set(options.visibleDrawUnitIds);
	const replaceableDrawUnitIds = new Set(
		options.resources.batch.drawSlices.flatMap((slice) =>
			slice.drawUnitIds.filter((drawUnitId) => visibleIds.has(drawUnitId)),
		),
	);
	if (replaceableDrawUnitIds.size === 0) {
		return {
			replaceableDrawUnitIds,
			noVisibleRouteCount: 1,
			fallbackSamples: [],
		};
	}
	return {
		replaceableDrawUnitIds,
		noVisibleRouteCount: 0,
		fallbackSamples: [],
	};
}

export function submitWebgl2AtlasStaticBatch({
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
	program: Webgl2AtlasStaticWorldProgram;
	viewProjectionMatrix: RenderMat4;
	resources: {
		batch: Webgl2AtlasStaticBatchResource;
		generation: Webgl2AtlasStaticGenerationResource;
	};
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
}): Webgl2AtlasStaticSubmitMetrics {
	if (replaceableDrawUnitIds.size === 0) {
		return {
			...createEmptyWebgl2AtlasStaticSubmitMetrics(),
			retainedDrawUnitCount,
		};
	}
	const metrics: Webgl2AtlasStaticSubmitMetrics = {
		shaderDrawCallCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
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
	gl.uniformMatrix4fv(
		program.uniforms.uViewProjection,
		false,
		viewProjectionMatrix,
	);
	gl.uniformMatrix4fv(
		program.uniforms.uBatchModel,
		false,
		resources.batch.batchModelMatrix,
	);
	uploadAtlasStaticMaterialRects(gl, program, resources.batch);
	if (stateCache.bindVertexArray(resources.batch.vertexArray.vertexArray)) {
		metrics.shaderDrawCallCount += 0;
	}
	for (const slice of resources.batch.drawSlices) {
		if (
			!slice.drawUnitIds.some((drawUnitId) =>
				replaceableDrawUnitIds.has(drawUnitId),
			)
		) {
			continue;
		}
		const texture = resources.generation.textures.find(
			(candidate) => candidate.textureIndex === slice.atlasTextureIndex,
		);
		if (!texture) {
			metrics.fallbackSamples = [
				...metrics.fallbackSamples,
				`atlas static draw slice ${slice.key} missing atlas texture ${slice.atlasTextureIndex}`,
			].slice(0, 8);
			continue;
		}
		if (stateCache.bindTexture2D(0, texture.texture.texture)) {
			// Counted as a state change in the aggregate submit path by callers.
		}
		gl.uniform2f(program.uniforms.uAtlasSize, texture.width, texture.height);
		gl.drawElements(
			gl.TRIANGLES,
			slice.indexCount,
			resources.batch.indexType,
			slice.firstIndex * indexTypeByteLength(gl, resources.batch.indexType),
		);
		metrics.shaderDrawCallCount += 1;
		metrics.submittedDrawSliceCount += 1;
		metrics.submittedTriangleCount += slice.indexCount / 3;
	}
	return metrics;
}

function uploadAtlasStaticMaterialRects(
	gl: WebGL2RenderingContext,
	program: Webgl2AtlasStaticWorldProgram,
	batch: Webgl2AtlasStaticBatchResource,
): void {
	const rects = new Float32Array(WEBGL2_ATLAS_STATIC_MAX_MATERIAL_SLOTS * 4);
	for (const slot of batch.materialSlots) {
		rects.set(slot.atlasRect, slot.index * 4);
	}
	gl.uniform4fv(program.uniforms.uMaterialRects, rects);
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
	throw new Error(`Unsupported atlas static index type ${indexType}.`);
}
