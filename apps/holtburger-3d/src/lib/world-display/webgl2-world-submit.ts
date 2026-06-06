import {
	buildAcPlacementMatrix,
	createTranslationMat4,
	multiplyMat4,
	multiplyMat4Into,
	type RenderMat4,
} from "./render-math";
import { normalizeOutdoorLandblockId } from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import {
	parseStaticMaterialFamilyKey,
	type StaticMaterialFamilyDescriptor,
} from "./static-material-artifacts";
import type { WorldRenderFrame } from "./world-render-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2TransitionPortalMaskResource } from "./webgl2-world-resources";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import {
	submitWebgl2TerrainFamilyTiles,
	type Webgl2TerrainFamilyWorldProgram,
} from "./webgl2/families/terrain-family-submit";
import type {
	Webgl2StaticBundleGeometryResource,
	Webgl2StaticBundleLayerResource,
	Webgl2StaticBundleLayerResourceStore,
	Webgl2StaticBundleMaterialResource,
	Webgl2StaticBundleMaterialTextureBinding,
} from "./webgl2/resources/static-bundle-layer-resources";
import type {
	Webgl2StructuredInteriorCellResource,
	Webgl2StructuredInteriorMaterialSliceResource,
	Webgl2StructuredInteriorResourceStore,
	Webgl2StructuredInteriorShellResource,
} from "./webgl2/resources/structured-interior-resources";

export type Webgl2FlatWorldProgram = Webgl2ProgramResource<
	"position",
	"uModelViewProjection" | "uColor"
>;
export type Webgl2TexturedWorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	| "uModelViewProjection"
	| "uColor"
	| "uAlphaTest"
	| "uTexture"
	| "uAtlasEnabled"
	| "uAtlasRect"
	| "uAtlasSize"
	| "uTexturePageWrapMode"
	| "uDetailTexture"
	| "uDetailTiling"
	| "uDetailEnabled"
>;
export type Webgl2IndexedP8WorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	| "uModelViewProjection"
	| "uColor"
	| "uAlphaTest"
	| "uIndexTexture"
	| "uPaletteTexture"
	| "uTextureSize"
	| "uPaletteColorCount"
	| "uClipThreshold"
	| "uRepeatS"
	| "uRepeatT"
	| "uDetailTexture"
	| "uDetailTiling"
	| "uDetailEnabled"
>;
export type Webgl2IndexedP16WorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	| "uModelViewProjection"
	| "uColor"
	| "uAlphaTest"
	| "uIndexTexture"
	| "uPaletteTexture"
	| "uTextureSize"
	| "uPaletteColorCount"
	| "uClipThreshold"
	| "uRepeatS"
	| "uRepeatT"
	| "uDetailTexture"
	| "uDetailTiling"
	| "uDetailEnabled"
>;

export interface Webgl2WorldSubmitMetrics {
	visibleTerrainTileCount: number;
	visibleTerrainOneDrawReadyTileCount: number;
	visibleTerrainOneDrawBlockedTileCount: number;
	visibleTerrainDrawSliceReadyCount: number;
	terrainOneDrawShaderDrawCallCount: number;
	terrainOneDrawSubmittedTileCount: number;
	terrainDrawSliceSubmittedCount: number;
	terrainOneDrawSubmittedTriangleCount: number;
	terrainOneDrawBlockerSamples: readonly string[];
	terrainOneDrawSubmitFallbackSamples: readonly string[];
	portalMaskResourceCount: number;
	submittedTerrainTileCount: number;
	terrainSubmittedTriangleCount: number;
	drawCallCount: number;
	programSwitchCount: number;
	vertexArrayBindCount: number;
	uniformUploadCount: number;
	stateChangeCount: number;
	triangleCount: number;
	staticBundleLayerSubmittedCount: number;
	visibleStaticBundleLayerCount: number;
	staticBundleGeometryCandidateCount: number;
	staticBundleGeometrySubmittedCount: number;
	staticBundleDrawCallCount: number;
	staticBundleTriangleCount: number;
	staticBundleSkippedGeometryCount: number;
	staticBundleSubmitFallbackSamples: readonly string[];
	structuredInteriorResourceSubmittedCount: number;
	structuredInteriorResourceDrawCallCount: number;
	structuredInteriorResourceTriangleCount: number;
	structuredInteriorResourceSkippedGeometryCount: number;
	structuredInteriorResourceFallbackSamples: readonly string[];
}

const EMPTY_SUBMIT_METRICS: Webgl2WorldSubmitMetrics = {
	visibleTerrainTileCount: 0,
	visibleTerrainOneDrawReadyTileCount: 0,
	visibleTerrainOneDrawBlockedTileCount: 0,
	visibleTerrainDrawSliceReadyCount: 0,
	terrainOneDrawShaderDrawCallCount: 0,
	terrainOneDrawSubmittedTileCount: 0,
	terrainDrawSliceSubmittedCount: 0,
	terrainOneDrawSubmittedTriangleCount: 0,
	terrainOneDrawBlockerSamples: [],
	terrainOneDrawSubmitFallbackSamples: [],
	portalMaskResourceCount: 0,
	submittedTerrainTileCount: 0,
	terrainSubmittedTriangleCount: 0,
	drawCallCount: 0,
	programSwitchCount: 0,
	vertexArrayBindCount: 0,
	uniformUploadCount: 0,
	stateChangeCount: 0,
	triangleCount: 0,
	staticBundleLayerSubmittedCount: 0,
	visibleStaticBundleLayerCount: 0,
	staticBundleGeometryCandidateCount: 0,
	staticBundleGeometrySubmittedCount: 0,
	staticBundleDrawCallCount: 0,
	staticBundleTriangleCount: 0,
	staticBundleSkippedGeometryCount: 0,
	staticBundleSubmitFallbackSamples: [],
	structuredInteriorResourceSubmittedCount: 0,
	structuredInteriorResourceDrawCallCount: 0,
	structuredInteriorResourceTriangleCount: 0,
	structuredInteriorResourceSkippedGeometryCount: 0,
	structuredInteriorResourceFallbackSamples: [],
};

export interface Webgl2TerrainTileSubmitReadinessPlan {
	oneDrawTiles: readonly Webgl2TerrainTileResource[];
	oneDrawSlices: readonly Webgl2TerrainTileResource["drawSlices"][number][];
	blockedTiles: readonly {
		tile: Webgl2TerrainTileResource;
		blockers: readonly string[];
	}[];
}

export function planWebgl2TerrainTileSubmitReadiness(
	terrainTiles: readonly Webgl2TerrainTileResource[],
): Webgl2TerrainTileSubmitReadinessPlan {
	const oneDrawTiles: Webgl2TerrainTileResource[] = [];
	const oneDrawSlices: Webgl2TerrainTileResource["drawSlices"] = [];
	const blockedTiles: Array<{
		tile: Webgl2TerrainTileResource;
		blockers: readonly string[];
	}> = [];
	for (const tile of terrainTiles) {
		if (tile.oneDrawReadiness.status === "ready") {
			oneDrawTiles.push(tile);
		} else {
			const readySlices = tile.drawSlices.filter(
				(slice) => slice.oneDrawReadiness.status === "ready",
			);
			if (readySlices.length > 0) {
				oneDrawSlices.push(...readySlices);
			} else {
				blockedTiles.push({
					tile,
					blockers: tile.oneDrawReadiness.blockers,
				});
			}
		}
	}
	return {
		oneDrawTiles,
		oneDrawSlices,
		blockedTiles,
	};
}

export function createEmptyWebgl2WorldSubmitMetrics(): Webgl2WorldSubmitMetrics {
	return { ...EMPTY_SUBMIT_METRICS };
}

export function submitWebgl2WorldFrame({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainFamilyProgram,
	indexedP8Program,
	indexedP16Program,
	staticBundleLayerResources = null,
	structuredInteriorResources = null,
	renderChunkTransforms = [],
	transitionPortalMasksById = new Map(),
	terrainTilesById = new Map(),
	frame,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainFamilyProgram?: Webgl2TerrainFamilyWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	staticBundleLayerResources?: Webgl2StaticBundleLayerResourceStore | null;
	structuredInteriorResources?: Webgl2StructuredInteriorResourceStore | null;
	renderChunkTransforms?: readonly RenderChunkTransform[];
	transitionPortalMasksById?: ReadonlyMap<
		string,
		Webgl2TransitionPortalMaskResource
	>;
	terrainTilesById?: ReadonlyMap<string, Webgl2TerrainTileResource>;
	frame: WorldRenderFrame;
}): Webgl2WorldSubmitMetrics {
	const terrainTiles = planWebgl2TerrainTileSubmitOrder(
		frame,
		terrainTilesById,
	);
	const staticBundleLayers = planWebgl2StaticBundleLayerSubmitOrder(
		frame,
		staticBundleLayerResources,
	);
	const portalMasks = planWebgl2TransitionPortalMaskSubmitOrder(
		frame,
		transitionPortalMasksById,
	);
	return submitWebgl2WorldResources({
		gl,
		stateCache,
		program,
		texturedProgram,
		terrainFamilyProgram,
		indexedP8Program,
		indexedP16Program,
		staticBundleLayers,
		structuredInteriorResources,
		renderChunkTransforms,
		viewProjectionMatrix: frame.viewProjectionMatrix,
		cameraPosition: frame.cameraFrame.position,
		terrainTiles,
		portalMaskResourceCount: portalMasks.length,
	});
}

export function submitWebgl2WorldResources({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainFamilyProgram,
	indexedP8Program,
	indexedP16Program,
	staticBundleLayers = [],
	structuredInteriorResources = null,
	renderChunkTransforms = [],
	viewProjectionMatrix,
	cameraPosition,
	terrainTiles = [],
	portalMaskResourceCount = 0,
	terrainBackfaceCulling = false,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainFamilyProgram?: Webgl2TerrainFamilyWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	staticBundleLayers?: readonly Webgl2StaticBundleLayerResource[];
	structuredInteriorResources?: Webgl2StructuredInteriorResourceStore | null;
	renderChunkTransforms?: readonly RenderChunkTransform[];
	viewProjectionMatrix: RenderMat4;
	cameraPosition: WorldRenderFrame["cameraFrame"]["position"];
	terrainTiles?: readonly Webgl2TerrainTileResource[];
	portalMaskResourceCount?: number;
	terrainBackfaceCulling?: boolean;
}): Webgl2WorldSubmitMetrics {
	const terrainReadinessPlan =
		planWebgl2TerrainTileSubmitReadiness(terrainTiles);
	const metrics: Webgl2WorldSubmitMetrics = {
		...EMPTY_SUBMIT_METRICS,
		visibleTerrainTileCount: terrainTiles.length,
		visibleTerrainOneDrawReadyTileCount:
			terrainReadinessPlan.oneDrawTiles.length,
		visibleTerrainOneDrawBlockedTileCount:
			terrainReadinessPlan.blockedTiles.length,
		visibleTerrainDrawSliceReadyCount:
			terrainReadinessPlan.oneDrawSlices.length,
		terrainOneDrawBlockerSamples: terrainReadinessPlan.blockedTiles
			.flatMap((entry) => entry.blockers)
			.slice(0, 8),
		portalMaskResourceCount,
	};
	if (terrainTiles.length === 0) {
		if (
			staticBundleLayers.length === 0 &&
			!structuredInteriorResources?.cellsByKey.size
		) {
			return metrics;
		}
	}
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: true,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	metrics.stateChangeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	metrics.stateChangeCount += stateCache.setStencilState({
		enabled: false,
		writeMask: 0xff,
		func: gl.ALWAYS,
		ref: 0,
		readMask: 0xff,
		fail: gl.KEEP,
		zfail: gl.KEEP,
		zpass: gl.KEEP,
	});
	submitWebgl2StaticBundleLayers({
		gl,
		stateCache,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		staticBundleLayers,
		renderChunkTransforms,
		metrics,
	});
	submitWebgl2StructuredInteriorResources({
		gl,
		stateCache,
		program,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		resources: structuredInteriorResources,
		renderChunkTransforms,
		metrics,
	});
	if (
		terrainFamilyProgram &&
		(terrainReadinessPlan.oneDrawTiles.length > 0 ||
			terrainReadinessPlan.oneDrawSlices.length > 0)
	) {
		const terrainFamilyMetrics = submitWebgl2TerrainFamilyTiles({
			gl,
			stateCache,
			program: terrainFamilyProgram,
			viewProjectionMatrix,
			cameraPosition,
			terrainTiles: [
				...terrainReadinessPlan.oneDrawTiles,
				...terrainReadinessPlan.oneDrawSlices,
			],
			terrainBackfaceCulling,
			renderChunkTransforms,
		});
		metrics.drawCallCount += terrainFamilyMetrics.shaderDrawCallCount;
		metrics.triangleCount += terrainFamilyMetrics.submittedTriangleCount;
		metrics.terrainOneDrawShaderDrawCallCount =
			terrainFamilyMetrics.shaderDrawCallCount;
		metrics.terrainOneDrawSubmittedTileCount =
			terrainReadinessPlan.oneDrawTiles.length;
		metrics.terrainDrawSliceSubmittedCount =
			terrainReadinessPlan.oneDrawSlices.length;
		metrics.terrainOneDrawSubmittedTriangleCount =
			terrainFamilyMetrics.submittedTriangleCount;
		metrics.terrainOneDrawSubmitFallbackSamples =
			terrainFamilyMetrics.fallbackSamples;
	}
	metrics.stateChangeCount += resetWorldSubmitExitRenderState({
		gl,
		stateCache,
	});
	return metrics;
}

function submitWebgl2StaticBundleLayers({
	gl,
	stateCache,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	staticBundleLayers,
	renderChunkTransforms,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	staticBundleLayers: readonly Webgl2StaticBundleLayerResource[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (staticBundleLayers.length === 0) {
		return;
	}
	metrics.visibleStaticBundleLayerCount = staticBundleLayers.length;
	const staticBundleLayerTransformsByLandblockId = new Map(
		renderChunkTransforms.map((transform) => [
			normalizeOutdoorLandblockId(transform.chunkLandblockId),
			transform,
		]),
	);
	for (const layer of staticBundleLayers) {
		const layerTransform = staticBundleLayerTransformsByLandblockId.get(
			normalizeOutdoorLandblockId(layer.landblockId),
		);
		const layerModelMatrix = createTranslationMat4(
			layerTransform?.offset ?? { x: 0, y: 0, z: 0 },
		);
		const materialByKey = new Map(
			layer.materialRecords.map((material) => [material.key, material]),
		);
		const geometries = [...layer.compactedBatches, ...layer.directEntries].sort(
			(left, right) => left.key.localeCompare(right.key),
		);
		metrics.staticBundleGeometryCandidateCount += geometries.length;
		let submittedLayer = false;
		for (const transparent of [false, true]) {
			metrics.stateChangeCount += stateCache.setBlendState({
				enabled: transparent,
				srcRgb: gl.SRC_ALPHA,
				dstRgb: gl.ONE_MINUS_SRC_ALPHA,
				srcAlpha: gl.ONE,
				dstAlpha: gl.ONE_MINUS_SRC_ALPHA,
				equationRgb: gl.FUNC_ADD,
				equationAlpha: gl.FUNC_ADD,
			});
			for (const geometry of geometries) {
				const material = materialByKey.get(geometry.materialRecordKey);
				if (!material || material.isTransparent !== transparent) {
					continue;
				}
				if (
					submitWebgl2StaticBundleGeometry({
						gl,
						stateCache,
						texturedProgram,
						indexedP8Program,
						indexedP16Program,
						viewProjectionMatrix,
						modelMatrix: layerModelMatrix,
						layer,
						geometry,
						material,
						metrics,
					})
				) {
					submittedLayer = true;
				}
			}
		}
		if (submittedLayer) {
			metrics.staticBundleLayerSubmittedCount += 1;
		}
	}
}

function submitWebgl2StructuredInteriorResources({
	gl,
	stateCache,
	program,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	resources,
	renderChunkTransforms,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	resources: Webgl2StructuredInteriorResourceStore | null | undefined;
	renderChunkTransforms: readonly RenderChunkTransform[];
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!resources) {
		return;
	}
	const cells = [...resources.cellsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (cells.length === 0) {
		return;
	}
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: true,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	for (const transparent of [false, true]) {
		metrics.stateChangeCount += stateCache.setBlendState({
			enabled: transparent,
			srcRgb: gl.SRC_ALPHA,
			dstRgb: gl.ONE_MINUS_SRC_ALPHA,
			srcAlpha: gl.ONE,
			dstAlpha: gl.ONE_MINUS_SRC_ALPHA,
			equationRgb: gl.FUNC_ADD,
			equationAlpha: gl.FUNC_ADD,
		});
		for (const cell of cells) {
			const modelMatrix = resolveStructuredInteriorCellModelMatrix({
				cell,
				chunkOffsetByKey,
			});
			if (!modelMatrix) {
				continue;
			}
			if (cell.materialSlices.length === 0) {
				if (!transparent && cell.fallbackShell) {
					submitWebgl2StructuredInteriorShell({
						gl,
						stateCache,
						program,
						viewProjectionMatrix,
						shell: cell.fallbackShell,
						modelMatrix,
						metrics,
					});
				}
				continue;
			}
			const materialByKey = new Map(
				cell.materialRecords.map((material) => [material.key, material]),
			);
			for (const slice of cell.materialSlices) {
				const material = materialByKey.get(slice.materialRecordKey);
				if (!material || material.isTransparent !== transparent) {
					continue;
				}
				submitWebgl2StructuredInteriorMaterialSlice({
					gl,
					stateCache,
					texturedProgram,
					indexedP8Program,
					indexedP16Program,
					viewProjectionMatrix,
					cell,
					slice,
					material,
					modelMatrix,
					metrics,
				});
			}
		}
	}
}

function resolveStructuredInteriorCellModelMatrix({
	cell,
	chunkOffsetByKey,
}: {
	cell: Webgl2StructuredInteriorCellResource;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
}): RenderMat4 | null {
	const chunkOffset = chunkOffsetByKey.get(cell.renderChunkKey);
	if (!chunkOffset) {
		return null;
	}
	return multiplyMat4(
		createTranslationMat4(chunkOffset),
		buildAcPlacementMatrix(
			cell.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
}

function submitWebgl2StructuredInteriorShell({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	shell,
	modelMatrix,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	viewProjectionMatrix: RenderMat4;
	shell: Webgl2StructuredInteriorShellResource;
	modelMatrix: RenderMat4;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindVertexArray(shell.vertexArray.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		program.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			modelMatrix,
		),
	);
	gl.uniform4fv(program.uniforms.uColor, shell.color);
	metrics.uniformUploadCount += 2;
	gl.drawElements(gl.TRIANGLES, shell.indexCount, shell.indexType, 0);
	metrics.drawCallCount += 1;
	metrics.triangleCount += shell.triangleCount;
	metrics.structuredInteriorResourceSubmittedCount += 1;
	metrics.structuredInteriorResourceDrawCallCount += 1;
	metrics.structuredInteriorResourceTriangleCount += shell.triangleCount;
}

function submitWebgl2StructuredInteriorMaterialSlice({
	gl,
	stateCache,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	cell,
	slice,
	material,
	modelMatrix,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	cell: Webgl2StructuredInteriorCellResource;
	slice: Webgl2StructuredInteriorMaterialSliceResource;
	material: Webgl2StaticBundleMaterialResource;
	modelMatrix: RenderMat4;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (material.familyKey === "indexed-paletted") {
		submitWebgl2IndexedStructuredInteriorMaterialSlice({
			gl,
			stateCache,
			indexedP8Program,
			indexedP16Program,
			viewProjectionMatrix,
			cell,
			slice,
			material,
			modelMatrix,
			metrics,
		});
		return;
	}
	if (material.familyKey !== "rgba-texture-page") {
		skipStructuredInteriorMaterialSlice({
			metrics,
			cell,
			slice,
			reason: `structured interior cell ${cell.envCellId} material ${material.key} family ${material.familyKey} is unsupported`,
		});
		return;
	}
	const base = resolveMaterialTextureBinding(material, "base-color");
	if (!base) {
		skipStructuredInteriorMaterialSlice({
			metrics,
			cell,
			slice,
			reason: `structured interior cell ${cell.envCellId} material ${material.key} has no base-color texture binding`,
		});
		return;
	}
	const detail = resolveMaterialTextureBinding(material, "detail");
	if (stateCache.useProgram(texturedProgram.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
		gl.uniform1i(texturedProgram.uniforms.uTexture, 0);
		gl.uniform1i(texturedProgram.uniforms.uDetailTexture, 1);
		metrics.uniformUploadCount += 2;
	}
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: !material.isTransparent,
		func: gl.LEQUAL,
	});
	if (stateCache.bindTexture2D(0, base.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(1, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindVertexArray(slice.vertexArray.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		texturedProgram.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			modelMatrix,
		),
	);
	gl.uniform4fv(texturedProgram.uniforms.uColor, [1, 1, 1, 1]);
	gl.uniform1f(texturedProgram.uniforms.uAlphaTest, 0);
	gl.uniform1i(texturedProgram.uniforms.uAtlasEnabled, 1);
	gl.uniform4f(
		texturedProgram.uniforms.uAtlasRect,
		base.rect[0],
		base.rect[1],
		base.rect[2],
		base.rect[3],
	);
	gl.uniform2f(texturedProgram.uniforms.uAtlasSize, base.width, base.height);
	gl.uniform2f(
		texturedProgram.uniforms.uTexturePageWrapMode,
		base.wrapS === "repeat" ? 1 : 0,
		base.wrapT === "repeat" ? 1 : 0,
	);
	gl.uniform1f(texturedProgram.uniforms.uDetailTiling, 1);
	gl.uniform1i(texturedProgram.uniforms.uDetailEnabled, detail ? 1 : 0);
	metrics.uniformUploadCount += 9;
	gl.drawElements(gl.TRIANGLES, slice.indexCount, slice.indexType, 0);
	recordStructuredInteriorMaterialSliceSubmitted(metrics, slice);
}

function submitWebgl2IndexedStructuredInteriorMaterialSlice({
	gl,
	stateCache,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	cell,
	slice,
	material,
	modelMatrix,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	cell: Webgl2StructuredInteriorCellResource;
	slice: Webgl2StructuredInteriorMaterialSliceResource;
	material: Webgl2StaticBundleMaterialResource;
	modelMatrix: RenderMat4;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	const descriptor = material.indexedMaterial;
	const index = resolveMaterialTextureBinding(material, "indexed-texels");
	const palette = resolveMaterialTextureBinding(material, "palette-lookup");
	if (!descriptor || !index || !palette) {
		skipStructuredInteriorMaterialSlice({
			metrics,
			cell,
			slice,
			reason: `structured interior cell ${cell.envCellId} material ${material.key} has incomplete indexed material bindings`,
		});
		return;
	}
	if (index.indexedFormat !== descriptor.indexFormat) {
		skipStructuredInteriorMaterialSlice({
			metrics,
			cell,
			slice,
			reason: `structured interior cell ${cell.envCellId} material ${material.key} indexed format ${index.indexedFormat ?? "missing"} does not match descriptor ${descriptor.indexFormat}`,
		});
		return;
	}
	const detail = resolveMaterialTextureBinding(material, "detail");
	const program =
		descriptor.indexFormat === "p8" ? indexedP8Program : indexedP16Program;
	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
		gl.uniform1i(program.uniforms.uIndexTexture, 0);
		gl.uniform1i(program.uniforms.uPaletteTexture, 1);
		gl.uniform1i(program.uniforms.uDetailTexture, 2);
		metrics.uniformUploadCount += 3;
	}
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: !material.isTransparent,
		func: gl.LEQUAL,
	});
	if (stateCache.bindTexture2D(0, index.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindTexture2D(1, palette.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(2, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindVertexArray(slice.vertexArray.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		program.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			modelMatrix,
		),
	);
	gl.uniform4fv(program.uniforms.uColor, [1, 1, 1, 1]);
	gl.uniform1f(program.uniforms.uAlphaTest, 0);
	gl.uniform2f(
		program.uniforms.uTextureSize,
		descriptor.width,
		descriptor.height,
	);
	gl.uniform1f(
		program.uniforms.uPaletteColorCount,
		descriptor.paletteColorCount,
	);
	gl.uniform1i(program.uniforms.uClipThreshold, descriptor.clipThreshold);
	gl.uniform1i(
		program.uniforms.uRepeatS,
		descriptor.wrapS === "repeat" ? 1 : 0,
	);
	gl.uniform1i(
		program.uniforms.uRepeatT,
		descriptor.wrapT === "repeat" ? 1 : 0,
	);
	gl.uniform1f(program.uniforms.uDetailTiling, 1);
	gl.uniform1i(program.uniforms.uDetailEnabled, detail ? 1 : 0);
	metrics.uniformUploadCount += 10;
	gl.drawElements(gl.TRIANGLES, slice.indexCount, slice.indexType, 0);
	recordStructuredInteriorMaterialSliceSubmitted(metrics, slice);
}

function recordStructuredInteriorMaterialSliceSubmitted(
	metrics: Webgl2WorldSubmitMetrics,
	slice: Webgl2StructuredInteriorMaterialSliceResource,
): void {
	metrics.drawCallCount += 1;
	metrics.triangleCount += slice.triangleCount;
	metrics.structuredInteriorResourceSubmittedCount += 1;
	metrics.structuredInteriorResourceDrawCallCount += 1;
	metrics.structuredInteriorResourceTriangleCount += slice.triangleCount;
}

function skipStructuredInteriorMaterialSlice({
	metrics,
	cell,
	slice,
	reason,
}: {
	metrics: Webgl2WorldSubmitMetrics;
	cell: Webgl2StructuredInteriorCellResource;
	slice: Webgl2StructuredInteriorMaterialSliceResource;
	reason: string;
}): void {
	metrics.structuredInteriorResourceSkippedGeometryCount += 1;
	metrics.structuredInteriorResourceFallbackSamples =
		appendStaticBundleSubmitFallbackSamples(
			metrics.structuredInteriorResourceFallbackSamples,
			[`${reason} for slice ${slice.key} in artifact ${cell.artifactKey}`],
		);
}

function submitWebgl2StaticBundleGeometry({
	gl,
	stateCache,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	modelMatrix,
	layer,
	geometry,
	material,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	modelMatrix: RenderMat4;
	layer: Webgl2StaticBundleLayerResource;
	geometry: Webgl2StaticBundleGeometryResource;
	material: Webgl2StaticBundleMaterialResource;
	metrics: Webgl2WorldSubmitMetrics;
}): boolean {
	const family = parseStaticMaterialFamilyKey(material.familyKey);
	if (!family) {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`unsupported static bundle material family ${material.familyKey}; layer ${layer.layerKey}; material ${material.key}`,
				],
			);
		return false;
	}
	if (isStaticBundleIndexedMaterialFamily(family)) {
		return submitWebgl2IndexedStaticBundleGeometry({
			gl,
			stateCache,
			indexedP8Program,
			indexedP16Program,
			viewProjectionMatrix,
			modelMatrix,
			layer,
			geometry,
			material,
			metrics,
		});
	}
	if (!isStaticBundleTextureMaterialFamily(family)) {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`unsupported static bundle material family ${material.familyKey}; layer ${layer.layerKey}; material ${material.key}`,
				],
			);
		return false;
	}
	const base = resolveMaterialTextureBinding(material, "base-color");
	if (!base) {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`missing static bundle base-color texture binding; layer ${layer.layerKey}; material ${material.key}; family ${material.familyKey}`,
				],
			);
		return false;
	}
	const detail = resolveMaterialTextureBinding(material, "detail");
	if (stateCache.useProgram(texturedProgram.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
		gl.uniform1i(texturedProgram.uniforms.uTexture, 0);
		gl.uniform1i(texturedProgram.uniforms.uDetailTexture, 1);
		metrics.uniformUploadCount += 2;
	}
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: !material.isTransparent,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	if (stateCache.bindTexture2D(0, base.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(1, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindVertexArray(geometry.vertexArray.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		texturedProgram.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			modelMatrix,
		),
	);
	gl.uniform4fv(texturedProgram.uniforms.uColor, [1, 1, 1, 1]);
	gl.uniform1f(texturedProgram.uniforms.uAlphaTest, 0);
	gl.uniform1i(texturedProgram.uniforms.uAtlasEnabled, 1);
	gl.uniform4f(
		texturedProgram.uniforms.uAtlasRect,
		base.rect[0],
		base.rect[1],
		base.rect[2],
		base.rect[3],
	);
	gl.uniform2f(texturedProgram.uniforms.uAtlasSize, base.width, base.height);
	gl.uniform2f(
		texturedProgram.uniforms.uTexturePageWrapMode,
		base.wrapS === "repeat" ? 1 : 0,
		base.wrapT === "repeat" ? 1 : 0,
	);
	gl.uniform1f(texturedProgram.uniforms.uDetailTiling, 1);
	gl.uniform1i(texturedProgram.uniforms.uDetailEnabled, detail ? 1 : 0);
	metrics.uniformUploadCount += 9;
	gl.drawElements(gl.TRIANGLES, geometry.indexCount, geometry.indexType, 0);
	metrics.drawCallCount += 1;
	metrics.triangleCount += geometry.triangleCount;
	metrics.staticBundleDrawCallCount += 1;
	metrics.staticBundleGeometrySubmittedCount += 1;
	metrics.staticBundleTriangleCount += geometry.triangleCount;
	return true;
}

function isStaticBundleIndexedMaterialFamily(
	family: StaticMaterialFamilyDescriptor,
): boolean {
	return family.kind === "indexed-paletted";
}

function isStaticBundleTextureMaterialFamily(
	family: StaticMaterialFamilyDescriptor,
): boolean {
	switch (family.kind) {
		case "texture-page":
			return true;
		case "indexed-paletted":
		case "unsupported":
			return false;
	}
}

function submitWebgl2IndexedStaticBundleGeometry({
	gl,
	stateCache,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	modelMatrix,
	layer,
	geometry,
	material,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	modelMatrix: RenderMat4;
	layer: Webgl2StaticBundleLayerResource;
	geometry: Webgl2StaticBundleGeometryResource;
	material: Webgl2StaticBundleMaterialResource;
	metrics: Webgl2WorldSubmitMetrics;
}): boolean {
	const descriptor = material.indexedMaterial;
	const index = resolveMaterialTextureBinding(material, "indexed-texels");
	const palette = resolveMaterialTextureBinding(material, "palette-lookup");
	if (!descriptor || !index || !palette) {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`incomplete static bundle indexed material bindings; layer ${layer.layerKey}; material ${material.key}`,
				],
			);
		return false;
	}
	if (index.indexedFormat !== descriptor.indexFormat) {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`static bundle indexed format mismatch ${index.indexedFormat ?? "missing"} vs ${descriptor.indexFormat}; layer ${layer.layerKey}; material ${material.key}`,
				],
			);
		return false;
	}
	const detail = resolveMaterialTextureBinding(material, "detail");
	const program =
		descriptor.indexFormat === "p8" ? indexedP8Program : indexedP16Program;
	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
		gl.uniform1i(program.uniforms.uIndexTexture, 0);
		gl.uniform1i(program.uniforms.uPaletteTexture, 1);
		gl.uniform1i(program.uniforms.uDetailTexture, 2);
		metrics.uniformUploadCount += 3;
	}
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: !material.isTransparent,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	if (stateCache.bindTexture2D(0, index.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindTexture2D(1, palette.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(2, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindVertexArray(geometry.vertexArray.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		program.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			modelMatrix,
		),
	);
	gl.uniform4fv(program.uniforms.uColor, [1, 1, 1, 1]);
	gl.uniform1f(program.uniforms.uAlphaTest, 0);
	gl.uniform2f(
		program.uniforms.uTextureSize,
		descriptor.width,
		descriptor.height,
	);
	gl.uniform1f(
		program.uniforms.uPaletteColorCount,
		descriptor.paletteColorCount,
	);
	gl.uniform1i(program.uniforms.uClipThreshold, descriptor.clipThreshold);
	gl.uniform1i(
		program.uniforms.uRepeatS,
		descriptor.wrapS === "repeat" ? 1 : 0,
	);
	gl.uniform1i(
		program.uniforms.uRepeatT,
		descriptor.wrapT === "repeat" ? 1 : 0,
	);
	gl.uniform1f(program.uniforms.uDetailTiling, 1);
	gl.uniform1i(program.uniforms.uDetailEnabled, detail ? 1 : 0);
	metrics.uniformUploadCount += 10;
	gl.drawElements(gl.TRIANGLES, geometry.indexCount, geometry.indexType, 0);
	metrics.drawCallCount += 1;
	metrics.triangleCount += geometry.triangleCount;
	metrics.staticBundleDrawCallCount += 1;
	metrics.staticBundleGeometrySubmittedCount += 1;
	metrics.staticBundleTriangleCount += geometry.triangleCount;
	return true;
}

function resolveMaterialTextureBinding(
	material: Webgl2StaticBundleMaterialResource,
	usageBucket: Webgl2StaticBundleMaterialTextureBinding["usageBucket"],
): Webgl2StaticBundleMaterialTextureBinding | null {
	return (
		material.textureBindings.find(
			(binding) => binding.usageBucket === usageBucket,
		) ?? null
	);
}

function appendStaticBundleSubmitFallbackSamples(
	current: readonly string[],
	next: readonly string[],
): readonly string[] {
	return [...current, ...next].slice(0, 8);
}

function resetWorldSubmitExitRenderState({
	gl,
	stateCache,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
}): number {
	let changeCount = stateCache.bindVertexArray(null) ? 1 : 0;
	changeCount += stateCache.setDepthState({
		enabled: true,
		write: true,
		func: gl.LEQUAL,
	});
	changeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	changeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	changeCount += stateCache.setStencilState({
		enabled: false,
		writeMask: 0xff,
		func: gl.ALWAYS,
		ref: 0,
		readMask: 0xff,
		fail: gl.KEEP,
		zfail: gl.KEEP,
		zpass: gl.KEEP,
	});
	return changeCount;
}

export function planWebgl2TerrainTileSubmitOrder(
	frame: WorldRenderFrame,
	terrainTilesById: ReadonlyMap<string, Webgl2TerrainTileResource>,
): Webgl2TerrainTileResource[] {
	const visibleTerrainTiles: Webgl2TerrainTileResource[] = [];
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			if (draw.kind !== "terrain-tile") {
				continue;
			}
			const terrainTile = terrainTilesById.get(draw.terrainTileId);
			if (!terrainTile) {
				throw new Error(
					`World render frame referenced missing WebGL2 terrain tile ${draw.terrainTileId}.`,
				);
			}
			visibleTerrainTiles.push(terrainTile);
		}
	}
	return visibleTerrainTiles.sort((left, right) =>
		compareStableAsciiStrings(left.id, right.id),
	);
}

export function planWebgl2StaticBundleLayerSubmitOrder(
	frame: WorldRenderFrame,
	staticBundleLayerResources: Webgl2StaticBundleLayerResourceStore | null,
): Webgl2StaticBundleLayerResource[] {
	const visibleLayers: Webgl2StaticBundleLayerResource[] = [];
	if (!staticBundleLayerResources) {
		return visibleLayers;
	}
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			if (draw.kind !== "static-bundle-layer") {
				continue;
			}
			const layer = staticBundleLayerResources.layersByKey.get(
				draw.staticBundleLayerId,
			);
			if (!layer) {
				throw new Error(
					`World render frame referenced missing WebGL2 static bundle layer ${draw.staticBundleLayerId}.`,
				);
			}
			visibleLayers.push(layer);
		}
	}
	return visibleLayers.sort((left, right) =>
		compareStableAsciiStrings(left.key, right.key),
	);
}

export function planWebgl2TransitionPortalMaskSubmitOrder(
	frame: WorldRenderFrame,
	transitionPortalMasksById:
		| ReadonlyMap<string, Webgl2TransitionPortalMaskResource>
		| null
		| undefined,
): Webgl2TransitionPortalMaskResource[] {
	const maskResources: Webgl2TransitionPortalMaskResource[] = [];
	if (!transitionPortalMasksById) {
		return maskResources;
	}
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			if (draw.kind !== "transition-portal-mask") {
				continue;
			}
			const mask = transitionPortalMasksById.get(draw.transitionPortalMaskId);
			if (!mask) {
				throw new Error(
					`World render frame referenced missing WebGL2 transition portal mask ${draw.transitionPortalMaskId}.`,
				);
			}
			maskResources.push(mask);
		}
	}
	return maskResources.sort((left, right) =>
		compareStableAsciiStrings(left.id, right.id),
	);
}

function compareStableAsciiStrings(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
