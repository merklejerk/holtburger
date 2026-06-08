import {
	buildAcPlacementMatrix,
	createTranslationMat4,
	multiplyMat4,
	multiplyMat4Into,
	type RenderMat4,
} from "./render-math";
import { formatHex32, normalizeOutdoorLandblockId } from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import {
	parseStaticMaterialFamilyKey,
	resolveStaticMaterialFamilyAlphaTest,
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
	| "uDetailAtlasRect"
	| "uDetailAtlasSize"
	| "uDetailTexturePageWrapMode"
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
	| "uIndexAtlasRect"
	| "uPaletteAtlasRect"
	| "uPaletteAtlasSize"
	| "uClipThreshold"
	| "uRepeatS"
	| "uRepeatT"
	| "uDetailTexture"
	| "uDetailTiling"
	| "uDetailEnabled"
	| "uDetailAtlasRect"
	| "uDetailAtlasSize"
	| "uDetailTexturePageWrapMode"
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
	| "uIndexAtlasRect"
	| "uPaletteAtlasRect"
	| "uPaletteAtlasSize"
	| "uClipThreshold"
	| "uRepeatS"
	| "uRepeatT"
	| "uDetailTexture"
	| "uDetailTiling"
	| "uDetailEnabled"
	| "uDetailAtlasRect"
	| "uDetailAtlasSize"
	| "uDetailTexturePageWrapMode"
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
	staticBundleSelectedObjectRecordCount: number;
	staticBundleSelectedSpatialHintCount: number;
	staticBundleSelectedSourceObjectCount: number;
	staticBundleSelectedCompactedBatchCount: number;
	staticBundleSelectedDirectEntryCount: number;
	staticBundleSelectedNoGeometryLayerCount: number;
	staticBundleSelectedUnsubmittedLayerCount: number;
	staticBundleSelectedMissingMaterialGeometryCount: number;
	staticBundleBuilderSkippedSurfaceCount: number;
	staticBundleBuilderSkippedReasonCounts: Record<string, number>;
	staticBundleGeometryCandidateTriangleCount: number;
	staticBundleSelectedLayerCoverageSamples: readonly string[];
	staticBundleGeometryCandidateCount: number;
	staticBundleGeometrySubmittedCount: number;
	staticBundleDrawCallCount: number;
	staticBundleTriangleCount: number;
	staticBundleSkippedGeometryCount: number;
	staticBundleSubmitFallbackSamples: readonly string[];
	staticBundleMaterialRecordCount: number;
	staticBundleMaterialFamilyCounts: Record<string, number>;
	staticBundleMaterialAlphaPolicyCounts: Record<string, number>;
	staticBundleMaterialBindingUsageCounts: Record<string, number>;
	staticBundleMaterialBaseColorBindingCount: number;
	staticBundleMaterialIndexedBindingCount: number;
	staticBundleSubmittedOpaqueGeometryCount: number;
	staticBundleSubmittedCutoutGeometryCount: number;
	staticBundleSubmittedTransparentGeometryCount: number;
	staticBundleSkippedGeometryReasonCounts: Record<string, number>;
	staticBundleSkippedGeometryFamilyCounts: Record<string, number>;
	staticBundleSkippedGeometryAlphaPolicyCounts: Record<string, number>;
	staticBundleSkippedGeometryBindingUsageCounts: Record<string, number>;
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
	staticBundleSelectedObjectRecordCount: 0,
	staticBundleSelectedSpatialHintCount: 0,
	staticBundleSelectedSourceObjectCount: 0,
	staticBundleSelectedCompactedBatchCount: 0,
	staticBundleSelectedDirectEntryCount: 0,
	staticBundleSelectedNoGeometryLayerCount: 0,
	staticBundleSelectedUnsubmittedLayerCount: 0,
	staticBundleSelectedMissingMaterialGeometryCount: 0,
	staticBundleBuilderSkippedSurfaceCount: 0,
	staticBundleBuilderSkippedReasonCounts: {},
	staticBundleGeometryCandidateTriangleCount: 0,
	staticBundleSelectedLayerCoverageSamples: [],
	staticBundleGeometryCandidateCount: 0,
	staticBundleGeometrySubmittedCount: 0,
	staticBundleDrawCallCount: 0,
	staticBundleTriangleCount: 0,
	staticBundleSkippedGeometryCount: 0,
	staticBundleSubmitFallbackSamples: [],
	staticBundleMaterialRecordCount: 0,
	staticBundleMaterialFamilyCounts: {},
	staticBundleMaterialAlphaPolicyCounts: {},
	staticBundleMaterialBindingUsageCounts: {},
	staticBundleMaterialBaseColorBindingCount: 0,
	staticBundleMaterialIndexedBindingCount: 0,
	staticBundleSubmittedOpaqueGeometryCount: 0,
	staticBundleSubmittedCutoutGeometryCount: 0,
	staticBundleSubmittedTransparentGeometryCount: 0,
	staticBundleSkippedGeometryReasonCounts: {},
	staticBundleSkippedGeometryFamilyCounts: {},
	staticBundleSkippedGeometryAlphaPolicyCounts: {},
	staticBundleSkippedGeometryBindingUsageCounts: {},
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
	return {
		...EMPTY_SUBMIT_METRICS,
		terrainOneDrawBlockerSamples: [],
		terrainOneDrawSubmitFallbackSamples: [],
		staticBundleSubmitFallbackSamples: [],
		staticBundleSelectedLayerCoverageSamples: [],
		staticBundleBuilderSkippedReasonCounts: {},
		staticBundleMaterialFamilyCounts: {},
		staticBundleMaterialAlphaPolicyCounts: {},
		staticBundleMaterialBindingUsageCounts: {},
		staticBundleSkippedGeometryReasonCounts: {},
		staticBundleSkippedGeometryFamilyCounts: {},
		staticBundleSkippedGeometryAlphaPolicyCounts: {},
		staticBundleSkippedGeometryBindingUsageCounts: {},
		structuredInteriorResourceFallbackSamples: [],
	};
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
	const metrics = createEmptyWebgl2WorldSubmitMetrics();
	metrics.visibleTerrainTileCount = terrainTiles.length;
	metrics.visibleTerrainOneDrawReadyTileCount =
		terrainReadinessPlan.oneDrawTiles.length;
	metrics.visibleTerrainOneDrawBlockedTileCount =
		terrainReadinessPlan.blockedTiles.length;
	metrics.visibleTerrainDrawSliceReadyCount =
		terrainReadinessPlan.oneDrawSlices.length;
	metrics.terrainOneDrawBlockerSamples = terrainReadinessPlan.blockedTiles
		.flatMap((entry) => entry.blockers)
		.slice(0, 8);
	metrics.portalMaskResourceCount = portalMaskResourceCount;
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
		program,
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
	program,
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
	program: Webgl2FlatWorldProgram;
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
		recordStaticBundleLayerMaterialDiagnostics(metrics, layer);
		const geometries = [...layer.compactedBatches, ...layer.directEntries].sort(
			(left, right) => left.key.localeCompare(right.key),
		);
		const missingMaterialGeometryCount = geometries.filter(
			(geometry) => !materialByKey.has(geometry.materialRecordKey),
		).length;
		const candidateTriangleCount = geometries.reduce(
			(total, geometry) => total + geometry.triangleCount,
			0,
		);
		recordStaticBundleLayerCoverageDiagnostics({
			metrics,
			layer,
			geometryCount: geometries.length,
			candidateTriangleCount,
			missingMaterialGeometryCount,
		});
		metrics.staticBundleGeometryCandidateCount += geometries.length;
		metrics.staticBundleGeometryCandidateTriangleCount += candidateTriangleCount;
		metrics.staticBundleSelectedMissingMaterialGeometryCount +=
			missingMaterialGeometryCount;
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
						program,
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
		} else {
			metrics.staticBundleSelectedUnsubmittedLayerCount += 1;
			recordStaticBundleLayerCoverageSample({
				metrics,
				layer,
				reason: geometries.length === 0 ? "no-geometry" : "no-submitted-geometry",
				geometryCount: geometries.length,
				candidateTriangleCount,
				missingMaterialGeometryCount,
			});
		}
	}
}

function recordStaticBundleLayerCoverageDiagnostics({
	metrics,
	layer,
	geometryCount,
	candidateTriangleCount,
	missingMaterialGeometryCount,
}: {
	metrics: Webgl2WorldSubmitMetrics;
	layer: Webgl2StaticBundleLayerResource;
	geometryCount: number;
	candidateTriangleCount: number;
	missingMaterialGeometryCount: number;
}): void {
	metrics.staticBundleSelectedObjectRecordCount += layer.objectRecordCount;
	metrics.staticBundleSelectedSpatialHintCount += layer.spatialHintCount;
	metrics.staticBundleSelectedSourceObjectCount += layer.sourceObjectCount;
	metrics.staticBundleSelectedCompactedBatchCount += layer.compactedBatches.length;
	metrics.staticBundleSelectedDirectEntryCount += layer.directEntries.length;
	metrics.staticBundleBuilderSkippedSurfaceCount +=
		layer.diagnosticSkippedSurfaceCount;
	for (const reason of layer.diagnosticSkippedReasons) {
		incrementCount(metrics.staticBundleBuilderSkippedReasonCounts, reason);
	}
	if (geometryCount === 0) {
		metrics.staticBundleSelectedNoGeometryLayerCount += 1;
	}
	if (
		geometryCount === 0 ||
		missingMaterialGeometryCount > 0 ||
		layer.diagnosticSkippedSurfaceCount > 0
	) {
		recordStaticBundleLayerCoverageSample({
			metrics,
			layer,
			reason:
				geometryCount === 0
					? "no-geometry"
					: missingMaterialGeometryCount > 0
						? "missing-material-record"
						: "builder-skipped-surfaces",
			geometryCount,
			candidateTriangleCount,
			missingMaterialGeometryCount,
		});
	}
}

function recordStaticBundleLayerCoverageSample({
	metrics,
	layer,
	reason,
	geometryCount,
	candidateTriangleCount,
	missingMaterialGeometryCount,
}: {
	metrics: Webgl2WorldSubmitMetrics;
	layer: Webgl2StaticBundleLayerResource;
	reason: string;
	geometryCount: number;
	candidateTriangleCount: number;
	missingMaterialGeometryCount: number;
}): void {
	const skippedReasons =
		layer.diagnosticSkippedReasons.length > 0
			? ` skipped-reasons=${layer.diagnosticSkippedReasons.slice(0, 3).join("|")}`
			: "";
	metrics.staticBundleSelectedLayerCoverageSamples =
		appendStaticBundleSubmitFallbackSamples(
			metrics.staticBundleSelectedLayerCoverageSamples,
			[
				[
					reason,
					`${formatHex32(layer.landblockId)}/${layer.bundleKind}`,
					`objects ${layer.objectRecordCount}/${layer.sourceObjectCount}`,
					`hints ${layer.spatialHintCount}`,
					`geom ${geometryCount} (${layer.compactedBatches.length} compacted, ${layer.directEntries.length} direct)`,
					`tris ${candidateTriangleCount}`,
					`materials ${layer.materialRecords.length}`,
					`missing-material-geoms ${missingMaterialGeometryCount}`,
					`builder-skipped ${layer.diagnosticSkippedSurfaceCount}${skippedReasons}`,
				].join("; "),
			],
		);
}

function recordStaticBundleLayerMaterialDiagnostics(
	metrics: Webgl2WorldSubmitMetrics,
	layer: Webgl2StaticBundleLayerResource,
): void {
	metrics.staticBundleMaterialRecordCount += layer.materialRecords.length;
	for (const material of layer.materialRecords) {
		const family = parseStaticMaterialFamilyKey(material.familyKey);
		incrementCount(
			metrics.staticBundleMaterialFamilyCounts,
			family?.kind ?? "unparsed",
		);
		incrementCount(
			metrics.staticBundleMaterialAlphaPolicyCounts,
			family?.alphaPolicy ?? "none",
		);
		for (const binding of material.textureBindings) {
			incrementCount(
				metrics.staticBundleMaterialBindingUsageCounts,
				binding.usageBucket,
			);
		}
		if (resolveMaterialTextureBinding(material, "base-color")) {
			metrics.staticBundleMaterialBaseColorBindingCount += 1;
		}
		if (resolveMaterialTextureBinding(material, "indexed-texels")) {
			metrics.staticBundleMaterialIndexedBindingCount += 1;
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
	uploadTexturedDetailAtlasUniforms(gl, texturedProgram, detail);
	metrics.uniformUploadCount += 12;
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
	gl.uniform4f(
		program.uniforms.uIndexAtlasRect,
		index.rect[0],
		index.rect[1],
		index.rect[2],
		index.rect[3],
	);
	gl.uniform4f(
		program.uniforms.uPaletteAtlasRect,
		palette.rect[0],
		palette.rect[1],
		palette.rect[2],
		palette.rect[3],
	);
	gl.uniform2f(
		program.uniforms.uPaletteAtlasSize,
		palette.width,
		palette.height,
	);
	gl.uniform1i(
		program.uniforms.uClipThreshold,
		descriptor.clipThreshold,
	);
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
	uploadIndexedDetailAtlasUniforms(gl, program, detail);
	metrics.uniformUploadCount += 16;
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
	program,
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
	program: Webgl2FlatWorldProgram;
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
		skipStaticBundleGeometry({
			metrics,
			layer,
			geometry,
			material,
			reasonCode: "unparsed-material-family",
			detail: `unsupported static bundle material family ${material.familyKey}`,
		});
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
	if (isStaticBundleFlatMaterialFamily(family)) {
		return submitWebgl2FlatStaticBundleGeometry({
			gl,
			stateCache,
			program,
			viewProjectionMatrix,
			modelMatrix,
			geometry,
			material,
			metrics,
		});
	}
	if (!isStaticBundleTextureMaterialFamily(family)) {
		skipStaticBundleGeometry({
			metrics,
			layer,
			geometry,
			material,
			reasonCode: "unsupported-material-family",
			detail: `unsupported static bundle material family ${material.familyKey}`,
		});
		return false;
	}
	const base = resolveMaterialTextureBinding(material, "base-color");
	if (!base) {
		skipStaticBundleGeometry({
			metrics,
			layer,
			geometry,
			material,
			reasonCode: "missing-base-color-binding",
			detail: "missing static bundle base-color texture binding",
		});
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
	gl.uniform4fv(texturedProgram.uniforms.uColor, material.color);
	gl.uniform1f(
		texturedProgram.uniforms.uAlphaTest,
		resolveStaticMaterialFamilyAlphaTest(family),
	);
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
	uploadTexturedDetailAtlasUniforms(gl, texturedProgram, detail);
	metrics.uniformUploadCount += 12;
	gl.drawElements(gl.TRIANGLES, geometry.indexCount, geometry.indexType, 0);
	recordSubmittedStaticBundleGeometry(metrics, family);
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

function isStaticBundleFlatMaterialFamily(
	family: StaticMaterialFamilyDescriptor,
): boolean {
	return family.kind === "flat-color";
}

function isStaticBundleTextureMaterialFamily(
	family: StaticMaterialFamilyDescriptor,
): boolean {
	switch (family.kind) {
		case "texture-page":
			return true;
		case "flat-color":
		case "indexed-paletted":
		case "unsupported":
			return false;
	}
}

function submitWebgl2FlatStaticBundleGeometry({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	modelMatrix,
	geometry,
	material,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	viewProjectionMatrix: RenderMat4;
	modelMatrix: RenderMat4;
	geometry: Webgl2StaticBundleGeometryResource;
	material: Webgl2StaticBundleMaterialResource;
	metrics: Webgl2WorldSubmitMetrics;
}): boolean {
	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
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
	gl.uniform4fv(program.uniforms.uColor, material.color);
	metrics.uniformUploadCount += 2;
	gl.drawElements(gl.TRIANGLES, geometry.indexCount, geometry.indexType, 0);
	const family = parseStaticMaterialFamilyKey(material.familyKey);
	if (family) {
		recordSubmittedStaticBundleGeometry(metrics, family);
	}
	metrics.drawCallCount += 1;
	metrics.triangleCount += geometry.triangleCount;
	metrics.staticBundleDrawCallCount += 1;
	metrics.staticBundleGeometrySubmittedCount += 1;
	metrics.staticBundleTriangleCount += geometry.triangleCount;
	return true;
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
		skipStaticBundleGeometry({
			metrics,
			layer,
			geometry,
			material,
			reasonCode: "incomplete-indexed-bindings",
			detail: "incomplete static bundle indexed material bindings",
		});
		return false;
	}
	if (index.indexedFormat !== descriptor.indexFormat) {
		skipStaticBundleGeometry({
			metrics,
			layer,
			geometry,
			material,
			reasonCode: "indexed-format-mismatch",
			detail: `static bundle indexed format mismatch ${index.indexedFormat ?? "missing"} vs ${descriptor.indexFormat}`,
		});
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
	gl.uniform4fv(program.uniforms.uColor, material.color);
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
	gl.uniform4f(
		program.uniforms.uIndexAtlasRect,
		index.rect[0],
		index.rect[1],
		index.rect[2],
		index.rect[3],
	);
	gl.uniform4f(
		program.uniforms.uPaletteAtlasRect,
		palette.rect[0],
		palette.rect[1],
		palette.rect[2],
		palette.rect[3],
	);
	gl.uniform2f(
		program.uniforms.uPaletteAtlasSize,
		palette.width,
		palette.height,
	);
	gl.uniform1i(
		program.uniforms.uClipThreshold,
		descriptor.clipThreshold,
	);
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
	uploadIndexedDetailAtlasUniforms(gl, program, detail);
	metrics.uniformUploadCount += 16;
	gl.drawElements(gl.TRIANGLES, geometry.indexCount, geometry.indexType, 0);
	const family = parseStaticMaterialFamilyKey(material.familyKey);
	if (family) {
		recordSubmittedStaticBundleGeometry(metrics, family);
	}
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
	return [...current, ...next].slice(0, 16);
}

function skipStaticBundleGeometry({
	metrics,
	layer,
	geometry,
	material,
	reasonCode,
	detail,
}: {
	metrics: Webgl2WorldSubmitMetrics;
	layer: Webgl2StaticBundleLayerResource;
	geometry: Webgl2StaticBundleGeometryResource;
	material: Webgl2StaticBundleMaterialResource;
	reasonCode: string;
	detail: string;
}): void {
	metrics.staticBundleSkippedGeometryCount += 1;
	incrementCount(metrics.staticBundleSkippedGeometryReasonCounts, reasonCode);
	const family = parseStaticMaterialFamilyKey(material.familyKey);
	incrementCount(
		metrics.staticBundleSkippedGeometryFamilyCounts,
		describeStaticBundleFamilySource(family),
	);
	incrementCount(
		metrics.staticBundleSkippedGeometryAlphaPolicyCounts,
		family?.alphaPolicy ?? "none",
	);
	if (material.textureBindings.length === 0) {
		incrementCount(metrics.staticBundleSkippedGeometryBindingUsageCounts, "none");
	} else {
		for (const binding of material.textureBindings) {
			incrementCount(
				metrics.staticBundleSkippedGeometryBindingUsageCounts,
				binding.usageBucket,
			);
		}
	}
	metrics.staticBundleSubmitFallbackSamples =
		appendStaticBundleSubmitFallbackSamples(
			metrics.staticBundleSubmitFallbackSamples,
			[
				[
					reasonCode,
					detail,
					`layer ${layer.layerKey}`,
					`material ${material.key}`,
					`family ${material.familyKey}`,
					`bindings ${describeStaticBundleMaterialBindings(material)}`,
					`geometry ${geometry.key}`,
					`objects ${geometry.objectKeys.slice(0, 3).join(",") || "none"}`,
				].join("; "),
			],
		);
}

function describeStaticBundleFamilySource(
	family: StaticMaterialFamilyDescriptor | null,
): string {
	if (!family) {
		return "unparsed";
	}
	return "sourceFamily" in family ? family.sourceFamily : family.kind;
}

function recordSubmittedStaticBundleGeometry(
	metrics: Webgl2WorldSubmitMetrics,
	family: StaticMaterialFamilyDescriptor,
): void {
	if (family.alphaPolicy === "cutout") {
		metrics.staticBundleSubmittedCutoutGeometryCount += 1;
		return;
	}
	if (
		family.alphaPolicy === "transparent-blend" ||
		family.alphaPolicy === "opacity-translucent"
	) {
		metrics.staticBundleSubmittedTransparentGeometryCount += 1;
		return;
	}
	metrics.staticBundleSubmittedOpaqueGeometryCount += 1;
}

function describeStaticBundleMaterialBindings(
	material: Webgl2StaticBundleMaterialResource,
): string {
	if (material.textureBindings.length === 0) {
		return "none";
	}
	return material.textureBindings
		.map(
			(binding) =>
				`${binding.usageBucket}/${binding.sampleClass}/${binding.wrapS}:${binding.wrapT}`,
		)
		.join(",");
}

function uploadTexturedDetailAtlasUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TexturedWorldProgram,
	detail: Webgl2StaticBundleMaterialTextureBinding | null,
): void {
	uploadDetailAtlasUniforms({
		gl,
		uniforms: program.uniforms,
		detail,
	});
}

function uploadIndexedDetailAtlasUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram,
	detail: Webgl2StaticBundleMaterialTextureBinding | null,
): void {
	uploadDetailAtlasUniforms({
		gl,
		uniforms: program.uniforms,
		detail,
	});
}

function uploadDetailAtlasUniforms({
	gl,
	uniforms,
	detail,
}: {
	gl: WebGL2RenderingContext;
	uniforms: Pick<
		Webgl2TexturedWorldProgram["uniforms"],
		"uDetailAtlasRect" | "uDetailAtlasSize" | "uDetailTexturePageWrapMode"
	>;
	detail: Webgl2StaticBundleMaterialTextureBinding | null;
}): void {
	gl.uniform4f(
		uniforms.uDetailAtlasRect,
		detail?.rect[0] ?? 0,
		detail?.rect[1] ?? 0,
		detail?.rect[2] ?? 1,
		detail?.rect[3] ?? 1,
	);
	gl.uniform2f(
		uniforms.uDetailAtlasSize,
		detail?.width ?? 1,
		detail?.height ?? 1,
	);
	gl.uniform2f(
		uniforms.uDetailTexturePageWrapMode,
		detail?.wrapS === "repeat" ? 1 : 0,
		detail?.wrapT === "repeat" ? 1 : 0,
	);
}

function incrementCount(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
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
