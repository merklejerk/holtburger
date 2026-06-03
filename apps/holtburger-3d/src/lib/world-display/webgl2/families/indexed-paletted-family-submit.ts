import type { RenderMat4 } from "../../render-math";
import type { Webgl2ProgramResource } from "../../webgl2-gl";
import type { Webgl2StateCache } from "../../webgl2-state-cache";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2IndexedPalettedFamilyResource,
} from "../resources/compacted-geometry-resources";
import { applyOpaqueCompactedFamilyRenderState } from "./family-render-state";
import type { Webgl2DetailTextureAtlasTextureResource } from "../resources/texture-atlas-generation";
import type {
	Webgl2IndexedResourceAtlasGenerationResource,
	Webgl2IndexedResourceAtlasTextureResource,
} from "../resources/indexed-resource-atlas-generation";

export const WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS = 128;

export type Webgl2IndexedPalettedFamilyWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "materialSlot",
	| "uViewProjection"
	| "uBatchModel"
	| "uIndexTexture"
	| "uPaletteTexture"
	| "uPaletteAtlasSize"
	| "uDetailAtlasTexture"
	| "uDetailAtlasSize"
	| "uMaterialColors"
	| "uMaterialParams"
	| "uIndexMaterialRects"
	| "uPaletteMaterialRects"
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
	indexedResourceAtlasGeneration: Webgl2IndexedResourceAtlasGenerationResource | null;
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
	if (
		options.resources.batches.length === 0 ||
		!options.resources.indexedResourceAtlasGeneration
	) {
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
		for (const slice of family.drawSlices) {
			if (!slice.drawUnitIds.some((drawUnitId) => visibleIds.has(drawUnitId))) {
				continue;
			}
			if (
				!resolveIndexedAtlasTexturesForSlice({
					slice,
					generation: options.resources.indexedResourceAtlasGeneration,
				})
			) {
				return { replaceableDrawUnitIds: new Set(), noVisibleRouteCount: 0 };
			}
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
		if (!resources.indexedResourceAtlasGeneration) {
			throw new Error(
				"Indexed-paletted family submit requires indexed resource atlas generation.",
			);
		}
		uploadIndexedPalettedFamilyMaterialTable(
			gl,
			program,
			family,
			resources.indexedResourceAtlasGeneration,
		);
		stateCache.bindVertexArray(batch.vertexArray.vertexArray);
		for (const slice of visibleSlices) {
			const atlasTextures = resolveIndexedAtlasTexturesForSlice({
				slice,
				generation: resources.indexedResourceAtlasGeneration,
			});
			if (!atlasTextures) {
				throw new Error(
					`Indexed-paletted family draw slice ${slice.key} references missing index or palette atlas texture.`,
				);
			}
			stateCache.bindTexture2D(0, atlasTextures.indexTexture.texture.texture);
			stateCache.bindTexture2D(1, atlasTextures.paletteTexture.texture.texture);
			gl.uniform2f(
				program.uniforms.uPaletteAtlasSize,
				atlasTextures.paletteTexture.width,
				atlasTextures.paletteTexture.height,
			);
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
	generation: Webgl2IndexedResourceAtlasGenerationResource,
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
	const indexRects = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	const paletteRects = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	const detailParams = new Float32Array(
		WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS * 4,
	);
	for (const [index, record] of family.materialTableRecords.entries()) {
		const indexPlacement = generation.indexPlacements.find(
			(placement) => placement.indexTextureKey === record.indexPageKey,
		);
		const palettePlacement = generation.palettePlacements.find(
			(placement) => placement.paletteTextureKey === record.palettePageKey,
		);
		if (!indexPlacement || !palettePlacement) {
			throw new Error(
				`Indexed-paletted material record ${record.key} references missing indexed atlas placement.`,
			);
		}
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
		indexRects.set(
			[
				indexPlacement.x,
				indexPlacement.y,
				indexPlacement.width,
				indexPlacement.height,
			],
			index * 4,
		);
		paletteRects.set(
			[
				palettePlacement.x,
				palettePlacement.y,
				palettePlacement.colorCount,
				1,
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
	gl.uniform4fv(program.uniforms.uIndexMaterialRects, indexRects);
	gl.uniform4fv(program.uniforms.uPaletteMaterialRects, paletteRects);
	gl.uniform4fv(program.uniforms.uDetailMaterialRects, detailRects);
	gl.uniform4fv(program.uniforms.uDetailMaterialParams, detailParams);
}

function resolveIndexedAtlasTexturesForSlice({
	slice,
	generation,
}: {
	slice: Webgl2IndexedPalettedFamilyResource["drawSlices"][number];
	generation: Webgl2IndexedResourceAtlasGenerationResource;
}): {
	indexTexture: Webgl2IndexedResourceAtlasTextureResource;
	paletteTexture: Webgl2IndexedResourceAtlasTextureResource;
} | null {
	const indexPlacement = generation.indexPlacements.find(
		(placement) => placement.indexTextureKey === slice.indexPageKey,
	);
	const palettePlacement = generation.palettePlacements.find(
		(placement) => placement.paletteTextureKey === slice.palettePageKey,
	);
	if (!indexPlacement || !palettePlacement) {
		return null;
	}
	const indexKind =
		slice.indexFormat === "p8" ? "p8-index-texels" : "index16-index-texels";
	const indexTexture = generation.indexTextures.find(
		(texture) =>
			texture.kind === indexKind &&
			texture.textureIndex === indexPlacement.atlasTextureIndex,
	);
	const paletteTexture = generation.paletteTextures.find(
		(texture) => texture.textureIndex === palettePlacement.atlasTextureIndex,
	);
	if (!indexTexture || !paletteTexture) {
		return null;
	}
	return { indexTexture, paletteTexture };
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
