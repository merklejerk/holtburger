import type { RenderMat4 } from "../../render-math";
import type {
	Webgl2ProgramResource,
	Webgl2Texture2DResource,
} from "../../webgl2-gl";
import type { Webgl2StateCache } from "../../webgl2-state-cache";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2IndexedPalettedFamilyResource,
} from "../../webgl2-compacted-geometry-resources";
import { applyOpaqueCompactedFamilyRenderState } from "./family-render-state";
import type { Webgl2DetailTextureAtlasTextureResource } from "../resources/texture-atlas-generation";

export const WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS = 128;

export type Webgl2IndexedPalettedFamilyWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "materialSlot",
	| "uViewProjection"
	| "uBatchModel"
	| "uIndexTexture"
	| "uPaletteTexture"
	| "uDetailAtlasTexture"
	| "uDetailAtlasSize"
	| "uMaterialColors"
	| "uMaterialParams"
	| "uDetailMaterialRects"
	| "uDetailMaterialParams"
>;

export interface Webgl2IndexedPalettedFamilySubmitMetrics {
	shaderDrawCallCount: number;
	submittedBatchCount: number;
	submittedDrawSliceCount: number;
	submittedTriangleCount: number;
	submittedSliceRepresentedDrawUnitCount: number;
	replacedDrawUnitCount: number;
	retainedDrawUnitCount: number;
	noVisibleRouteCount: number;
}

export interface Webgl2IndexedPalettedFamilySubmitResources {
	batches: readonly Webgl2CompactedGeometryBatchResource[];
	indexedPalettedFamilies: readonly Webgl2IndexedPalettedFamilyResource[];
	texturesByKey: ReadonlyMap<string, Webgl2Texture2DResource>;
	detailTextures: readonly Webgl2DetailTextureAtlasTextureResource[];
}

export function createEmptyWebgl2IndexedPalettedFamilySubmitMetrics(): Webgl2IndexedPalettedFamilySubmitMetrics {
	return {
		shaderDrawCallCount: 0,
		submittedBatchCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
		submittedSliceRepresentedDrawUnitCount: 0,
		replacedDrawUnitCount: 0,
		retainedDrawUnitCount: 0,
		noVisibleRouteCount: 0,
	};
}

export function planWebgl2IndexedPalettedFamilyReplacement(options: {
	visibleDrawUnitIds: readonly string[];
	resources: Webgl2IndexedPalettedFamilySubmitResources;
}): {
	replaceableDrawUnitIds: ReadonlySet<string>;
	noVisibleRouteCount: number;
} {
	if (options.resources.batches.length === 0) {
		return { replaceableDrawUnitIds: new Set(), noVisibleRouteCount: 0 };
	}
	for (const family of options.resources.indexedPalettedFamilies) {
		if (
			family.materialTableRecords.length >
			WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS
		) {
			return { replaceableDrawUnitIds: new Set(), noVisibleRouteCount: 0 };
		}
	}
	const visibleIds = new Set(options.visibleDrawUnitIds);
	const replaceableDrawUnitIds = new Set<string>();
	let noVisibleRouteCount = 0;
	for (const family of options.resources.indexedPalettedFamilies) {
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
	return { replaceableDrawUnitIds, noVisibleRouteCount };
}

export function submitWebgl2IndexedPalettedFamilyBatches({
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
	program: Webgl2IndexedPalettedFamilyWorldProgram;
	viewProjectionMatrix: RenderMat4;
	resources: Webgl2IndexedPalettedFamilySubmitResources;
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
}): Webgl2IndexedPalettedFamilySubmitMetrics {
	if (replaceableDrawUnitIds.size === 0) {
		return {
			...createEmptyWebgl2IndexedPalettedFamilySubmitMetrics(),
			retainedDrawUnitCount,
		};
	}
	const metrics: Webgl2IndexedPalettedFamilySubmitMetrics = {
		shaderDrawCallCount: 0,
		submittedBatchCount: 0,
		submittedDrawSliceCount: 0,
		submittedTriangleCount: 0,
		submittedSliceRepresentedDrawUnitCount: 0,
		replacedDrawUnitCount: replaceableDrawUnitIds.size,
		retainedDrawUnitCount,
		noVisibleRouteCount: 0,
	};
	applyOpaqueCompactedFamilyRenderState({ gl, stateCache });
	stateCache.useProgram(program.program);
	gl.uniform1i(program.uniforms.uIndexTexture, 0);
	gl.uniform1i(program.uniforms.uPaletteTexture, 1);
	gl.uniform1i(program.uniforms.uDetailAtlasTexture, 2);
	gl.uniformMatrix4fv(
		program.uniforms.uViewProjection,
		false,
		viewProjectionMatrix,
	);
	for (const batch of resources.batches) {
		const family = resources.indexedPalettedFamilies.find(
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
		uploadIndexedPalettedFamilyMaterialTable(gl, program, family);
		stateCache.bindVertexArray(batch.vertexArray.vertexArray);
		for (const slice of visibleSlices) {
			const indexTexture = resources.texturesByKey.get(slice.indexPageKey);
			const paletteTexture = resources.texturesByKey.get(slice.palettePageKey);
			if (!indexTexture || !paletteTexture) {
				throw new Error(
					`Indexed-paletted family draw slice ${slice.key} references missing index or palette texture.`,
				);
			}
			stateCache.bindTexture2D(0, indexTexture.texture);
			stateCache.bindTexture2D(1, paletteTexture.texture);
			const detailTexture =
				slice.detailAtlasTextureIndex == null
					? null
					: resources.detailTextures.find(
							(candidate) =>
								candidate.textureIndex === slice.detailAtlasTextureIndex,
						);
			if (slice.detailAtlasTextureIndex != null && !detailTexture) {
				throw new Error(
					`Indexed-paletted family draw slice ${slice.key} references missing detail atlas texture ${slice.detailAtlasTextureIndex}.`,
				);
			}
			if (detailTexture) {
				stateCache.bindTexture2D(2, detailTexture.texture.texture);
			}
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

function uploadIndexedPalettedFamilyMaterialTable(
	gl: WebGL2RenderingContext,
	program: Webgl2IndexedPalettedFamilyWorldProgram,
	family: Webgl2IndexedPalettedFamilyResource,
): void {
	const colors = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	const materialParams = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	const detailRects = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	const detailParams = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	for (const [index, record] of family.materialTableRecords.entries()) {
		colors.set(record.color, index * 4);
		materialParams.set(
			[
				record.indexPageWidth,
				record.indexPageHeight,
				record.paletteColorCount,
				record.clipThreshold,
			],
			index * 4,
		);
		detailRects.set(record.detailAtlasRect, index * 4);
		detailParams.set(
			[
				record.wrapS === "repeat" ? 1 : 0,
				record.wrapT === "repeat" ? 1 : 0,
				record.detailTiling,
				record.detailAtlasTextureIndex == null ? 0 : 1,
			],
			index * 4,
		);
	}
	gl.uniform4fv(program.uniforms.uMaterialColors, colors);
	gl.uniform4fv(program.uniforms.uMaterialParams, materialParams);
	gl.uniform4fv(program.uniforms.uDetailMaterialRects, detailRects);
	gl.uniform4fv(program.uniforms.uDetailMaterialParams, detailParams);
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
		`Unsupported indexed-paletted family submit index type ${indexType}.`,
	);
}
