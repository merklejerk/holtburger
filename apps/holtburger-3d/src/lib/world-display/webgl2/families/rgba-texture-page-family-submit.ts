import type { RenderMat4 } from "../../render-math";
import type { Webgl2ProgramResource } from "../../webgl2-gl";
import type { Webgl2StateCache } from "../../webgl2-state-cache";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2RgbaTexturePageFamilyResource,
} from "../../webgl2-compacted-geometry-resources";
import { applyOpaqueCompactedFamilyRenderState } from "./family-render-state";
import type { Webgl2TextureAtlasGenerationResource } from "../../webgl2-texture-atlas-generation";

export const WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS = 128;

export type Webgl2RgbaTexturePageFamilyWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "materialSlot",
	| "uViewProjection"
	| "uBatchModel"
	| "uAtlasTexture"
	| "uAtlasSize"
	| "uDetailAtlasTexture"
	| "uDetailAtlasSize"
	| "uMaterialRects"
	| "uMaterialWrapModes"
	| "uMaterialAlphaTests"
	| "uDetailMaterialRects"
	| "uDetailMaterialTilings"
	| "uDetailMaterialEnabled"
>;

export interface Webgl2RgbaTexturePageFamilySubmitMetrics {
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

export interface Webgl2RgbaTexturePageFamilySubmitResources {
	batches: readonly Webgl2CompactedGeometryBatchResource[];
	rgbaTexturePageFamilies: readonly Webgl2RgbaTexturePageFamilyResource[];
	generation: Webgl2TextureAtlasGenerationResource | null;
}

export function createEmptyWebgl2RgbaTexturePageFamilySubmitMetrics(): Webgl2RgbaTexturePageFamilySubmitMetrics {
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

export function planWebgl2RgbaTexturePageFamilyReplacement(options: {
	visibleDrawUnitIds: readonly string[];
	resources: Webgl2RgbaTexturePageFamilySubmitResources;
}): {
	replaceableDrawUnitIds: ReadonlySet<string>;
	noVisibleRouteCount: number;
	fallbackSamples: readonly string[];
} {
	if (!options.resources.generation) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: [
				"RGBA texture-page family submit missing texture atlas generation",
			],
		};
	}
	if (options.resources.batches.length === 0) {
		return {
			replaceableDrawUnitIds: new Set(),
			noVisibleRouteCount: 0,
			fallbackSamples: [
				"RGBA texture-page family submit missing compacted geometry batches",
			],
		};
	}
	for (const family of options.resources.rgbaTexturePageFamilies) {
		if (
			family.materialSlots.length > WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS
		) {
			return {
				replaceableDrawUnitIds: new Set(),
				noVisibleRouteCount: 0,
				fallbackSamples: [
					`RGBA texture-page family submit material slots ${family.materialSlots.length} exceed ${WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS}`,
				],
			};
		}
	}
	const visibleIds = new Set(options.visibleDrawUnitIds);
	const replaceableDrawUnitIds = new Set<string>();
	let noVisibleRouteCount = 0;
	for (const family of options.resources.rgbaTexturePageFamilies) {
		const batchVisibleDrawUnitIds = family.drawSlices.flatMap((slice) =>
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

export function submitWebgl2RgbaTexturePageFamilyBatches({
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
	program: Webgl2RgbaTexturePageFamilyWorldProgram;
	viewProjectionMatrix: RenderMat4;
	resources: {
		batches: readonly Webgl2CompactedGeometryBatchResource[];
		rgbaTexturePageFamilies: readonly Webgl2RgbaTexturePageFamilyResource[];
		generation: Webgl2TextureAtlasGenerationResource;
	};
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
}): Webgl2RgbaTexturePageFamilySubmitMetrics {
	if (replaceableDrawUnitIds.size === 0) {
		return {
			...createEmptyWebgl2RgbaTexturePageFamilySubmitMetrics(),
			retainedDrawUnitCount,
		};
	}
	const metrics: Webgl2RgbaTexturePageFamilySubmitMetrics = {
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
	applyOpaqueCompactedFamilyRenderState({ gl, stateCache });
	gl.uniform1i(program.uniforms.uAtlasTexture, 0);
	gl.uniform1i(program.uniforms.uDetailAtlasTexture, 1);
	gl.uniformMatrix4fv(
		program.uniforms.uViewProjection,
		false,
		viewProjectionMatrix,
	);
	for (const batch of resources.batches) {
		const family = resources.rgbaTexturePageFamilies.find(
			(candidate) => candidate.geometryBatchKey === batch.key,
		);
		if (!family) {
			continue;
		}
		const visibleSlices = family.drawSlices.filter((slice) =>
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
		uploadRgbaTexturePageFamilyMaterialRects(gl, program, family);
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
					`RGBA texture-page family draw slice ${slice.key} missing atlas texture ${slice.atlasTextureIndex}`,
				].slice(0, 8);
				continue;
			}
			if (stateCache.bindTexture2D(0, texture.texture.texture)) {
				// Counted as a state change in the aggregate submit path by callers.
			}
			const detailTexture =
				slice.detailAtlasTextureIndex == null
					? null
					: (resources.generation.detailTextures ?? []).find(
							(candidate) =>
								candidate.textureIndex === slice.detailAtlasTextureIndex,
						);
			if (slice.detailAtlasTextureIndex != null && !detailTexture) {
				metrics.fallbackSamples = [
					...metrics.fallbackSamples,
					`RGBA texture-page family draw slice ${slice.key} missing detail atlas texture ${slice.detailAtlasTextureIndex}`,
				].slice(0, 8);
				continue;
			}
			if (
				detailTexture &&
				stateCache.bindTexture2D(1, detailTexture.texture.texture)
			) {
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

function uploadRgbaTexturePageFamilyMaterialRects(
	gl: WebGL2RenderingContext,
	program: Webgl2RgbaTexturePageFamilyWorldProgram,
	family: Webgl2RgbaTexturePageFamilyResource,
): void {
	const rects = new Float32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS * 4,
	);
	const detailRects = new Float32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS * 4,
	);
	const wrapModes = new Int32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS * 2,
	);
	const alphaTests = new Float32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS,
	);
	const detailTilings = new Float32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS,
	);
	const detailEnabled = new Int32Array(
		WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS,
	);
	for (const slot of family.materialSlots) {
		rects.set(slot.atlasRect, slot.index * 4);
		wrapModes.set(
			[slot.wrapS === "repeat" ? 1 : 0, slot.wrapT === "repeat" ? 1 : 0],
			slot.index * 2,
		);
		alphaTests[slot.index] = slot.alphaTest;
		detailRects.set(slot.detailAtlasRect ?? [0, 0, 1, 1], slot.index * 4);
		detailTilings[slot.index] = slot.detailTiling ?? 1;
		detailEnabled[slot.index] = slot.detailAtlasTextureIndex == null ? 0 : 1;
	}
	gl.uniform4fv(program.uniforms.uMaterialRects, rects);
	gl.uniform2iv(program.uniforms.uMaterialWrapModes, wrapModes);
	gl.uniform1fv(program.uniforms.uMaterialAlphaTests, alphaTests);
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
	throw new Error(
		`Unsupported RGBA texture-page family submit index type ${indexType}.`,
	);
}
