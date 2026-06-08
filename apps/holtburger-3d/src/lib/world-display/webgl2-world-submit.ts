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
	resolveStaticMaterialFamilyAlphaTest,
	type StaticMaterialFamilyDescriptor,
} from "./static-material-artifacts";
import {
	WORLD_RENDER_DRAW_KIND,
	type WorldRenderFrame,
} from "./world-render-frame";
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
	staticBundleMaterialRecordCount: number;
	staticBundleMaterialFamilyCounts: Record<string, number>;
	staticBundleMaterialAlphaPolicyCounts: Record<string, number>;
	staticBundleMaterialBindingUsageCounts: Record<string, number>;
	staticBundleMaterialBaseColorBindingCount: number;
	staticBundleMaterialIndexedBindingCount: number;
	materialSurfaceSubmittedCount: number;
	materialSurfaceSubmittedCountsByDomain: Record<Webgl2MaterialDrawDomain, number>;
	materialSurfaceDrawCallCountsByDomain: Record<Webgl2MaterialDrawDomain, number>;
	materialSurfaceTriangleCountsByDomain: Record<Webgl2MaterialDrawDomain, number>;
	materialSurfaceSkippedCount: number;
	materialSurfaceSkippedCountsByDomain: Record<Webgl2MaterialDrawDomain, number>;
	materialSurfaceSubmittedAlphaPolicyCounts: Record<string, number>;
	materialSurfaceSkippedReasonCounts: Record<string, number>;
	materialSurfaceSkippedFamilyCounts: Record<string, number>;
	materialSurfaceSkippedAlphaPolicyCounts: Record<string, number>;
	materialSurfaceSkippedBindingUsageCounts: Record<string, number>;
	materialSurfaceSubmitFallbackSamples: readonly string[];
	structuredInteriorShellSubmittedCount: number;
	structuredInteriorShellDrawCallCount: number;
	structuredInteriorShellTriangleCount: number;
}

export const WEBGL2_MATERIAL_DRAW_DOMAIN = {
	staticBundle: "static-bundle",
	structuredInterior: "structured-interior",
} as const;

export type Webgl2MaterialDrawDomain =
	(typeof WEBGL2_MATERIAL_DRAW_DOMAIN)[keyof typeof WEBGL2_MATERIAL_DRAW_DOMAIN];

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
	staticBundleMaterialRecordCount: 0,
	staticBundleMaterialFamilyCounts: {},
	staticBundleMaterialAlphaPolicyCounts: {},
	staticBundleMaterialBindingUsageCounts: {},
	staticBundleMaterialBaseColorBindingCount: 0,
	staticBundleMaterialIndexedBindingCount: 0,
	materialSurfaceSubmittedCount: 0,
	materialSurfaceSubmittedCountsByDomain: createEmptyMaterialDrawDomainCounts(),
	materialSurfaceDrawCallCountsByDomain: createEmptyMaterialDrawDomainCounts(),
	materialSurfaceTriangleCountsByDomain: createEmptyMaterialDrawDomainCounts(),
	materialSurfaceSkippedCount: 0,
	materialSurfaceSkippedCountsByDomain: createEmptyMaterialDrawDomainCounts(),
	materialSurfaceSubmittedAlphaPolicyCounts: {},
	materialSurfaceSkippedReasonCounts: {},
	materialSurfaceSkippedFamilyCounts: {},
	materialSurfaceSkippedAlphaPolicyCounts: {},
	materialSurfaceSkippedBindingUsageCounts: {},
	materialSurfaceSubmitFallbackSamples: [],
	structuredInteriorShellSubmittedCount: 0,
	structuredInteriorShellDrawCallCount: 0,
	structuredInteriorShellTriangleCount: 0,
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
		staticBundleSelectedLayerCoverageSamples: [],
		staticBundleBuilderSkippedReasonCounts: {},
		staticBundleMaterialFamilyCounts: {},
		staticBundleMaterialAlphaPolicyCounts: {},
		staticBundleMaterialBindingUsageCounts: {},
		materialSurfaceSubmittedCountsByDomain:
			createEmptyMaterialDrawDomainCounts(),
		materialSurfaceDrawCallCountsByDomain:
			createEmptyMaterialDrawDomainCounts(),
		materialSurfaceTriangleCountsByDomain:
			createEmptyMaterialDrawDomainCounts(),
		materialSurfaceSkippedCountsByDomain: createEmptyMaterialDrawDomainCounts(),
		materialSurfaceSubmittedAlphaPolicyCounts: {},
		materialSurfaceSkippedReasonCounts: {},
		materialSurfaceSkippedFamilyCounts: {},
		materialSurfaceSkippedAlphaPolicyCounts: {},
		materialSurfaceSkippedBindingUsageCounts: {},
		materialSurfaceSubmitFallbackSamples: [],
	};
}

function createEmptyMaterialDrawDomainCounts(): Record<
	Webgl2MaterialDrawDomain,
	number
> {
	return {
		[WEBGL2_MATERIAL_DRAW_DOMAIN.staticBundle]: 0,
		[WEBGL2_MATERIAL_DRAW_DOMAIN.structuredInterior]: 0,
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
		incrementCount(
			metrics.staticBundleMaterialFamilyCounts,
			material.family.kind,
		);
		incrementCount(
			metrics.staticBundleMaterialAlphaPolicyCounts,
			material.family.alphaPolicy ?? "none",
		);
		for (const binding of material.textureBindings) {
			incrementCount(
				metrics.staticBundleMaterialBindingUsageCounts,
				binding.role,
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
					program,
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
	metrics.structuredInteriorShellSubmittedCount += 1;
	metrics.structuredInteriorShellDrawCallCount += 1;
	metrics.structuredInteriorShellTriangleCount += shell.triangleCount;
}

function submitWebgl2StructuredInteriorMaterialSlice({
	gl,
	stateCache,
	program,
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
	program: Webgl2FlatWorldProgram;
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
	const result = submitWebgl2MaterialDrawSurface({
		gl,
		stateCache,
		program,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		metrics,
		surface: {
			domain: WEBGL2_MATERIAL_DRAW_DOMAIN.structuredInterior,
			vertexArray: slice.vertexArray.vertexArray,
			indexCount: slice.indexCount,
			indexType: slice.indexType,
			triangleCount: slice.triangleCount,
			modelMatrix,
			material,
			colorPolicy: "white-for-textured-and-indexed",
			depthWrite: !material.isTransparent,
			cull: { enabled: false, mode: gl.BACK },
			diagnosticParts: [
				`cell ${cell.envCellId}`,
				`slice ${slice.key}`,
				`artifact ${cell.artifactKey}`,
			],
		},
	});
	recordWebgl2MaterialDrawResult(metrics, result);
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
	const result = submitWebgl2MaterialDrawSurface({
		gl,
		stateCache,
		program,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		metrics,
		surface: {
			domain: WEBGL2_MATERIAL_DRAW_DOMAIN.staticBundle,
			vertexArray: geometry.vertexArray.vertexArray,
			indexCount: geometry.indexCount,
			indexType: geometry.indexType,
			triangleCount: geometry.triangleCount,
			modelMatrix,
			material,
			colorPolicy: "material",
			depthWrite: !material.isTransparent,
			cull: { enabled: false, mode: gl.BACK },
			diagnosticParts: [
				`layer ${layer.layerKey}`,
				`geometry ${geometry.key}`,
				`objects ${geometry.objectKeys.slice(0, 3).join(",") || "none"}`,
			],
		},
	});
	recordWebgl2MaterialDrawResult(metrics, result);
	return result.status === "submitted";
}

interface Webgl2MaterialDrawSurface {
	domain: Webgl2MaterialDrawDomain;
	vertexArray: WebGLVertexArrayObject;
	indexCount: number;
	indexType: GLenum;
	triangleCount: number;
	modelMatrix: RenderMat4;
	material: Webgl2StaticBundleMaterialResource;
	colorPolicy: "material" | "white-for-textured-and-indexed";
	depthWrite: boolean;
	cull: { enabled: boolean; mode: GLenum };
	diagnosticParts: readonly string[];
}

type Webgl2MaterialDrawResult =
	| {
			status: "submitted";
			domain: Webgl2MaterialDrawDomain;
			triangleCount: number;
			family: StaticMaterialFamilyDescriptor;
	  }
	| {
			status: "skipped";
			domain: Webgl2MaterialDrawDomain;
			material: Webgl2StaticBundleMaterialResource;
			reasonCode: string;
			detail: string;
			diagnosticParts: readonly string[];
	  };

function submitWebgl2MaterialDrawSurface({
	gl,
	stateCache,
	program,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	surface,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	surface: Webgl2MaterialDrawSurface;
	metrics: Webgl2WorldSubmitMetrics;
}): Webgl2MaterialDrawResult {
	return submitWebgl2StaticMaterialByFamily({
		material: surface.material,
		submitIndexed() {
			return submitWebgl2IndexedMaterialDrawSurface({
				gl,
				stateCache,
				indexedP8Program,
				indexedP16Program,
				viewProjectionMatrix,
				surface,
				metrics,
			});
		},
		submitFlat() {
			return submitWebgl2FlatMaterialDrawSurface({
				gl,
				stateCache,
				program,
				viewProjectionMatrix,
				surface,
				metrics,
			});
		},
		submitTexture(family) {
			return submitWebgl2TexturedMaterialDrawSurface({
				gl,
				stateCache,
				texturedProgram,
				viewProjectionMatrix,
				surface,
				metrics,
				family,
			});
		},
		skipUnsupported() {
			return createSkippedMaterialDrawResult({
				surface,
				reasonCode: "unsupported-material-family",
				detail: `unsupported material family ${surface.material.familyKey}`,
			});
		},
	});
}

function submitWebgl2TexturedMaterialDrawSurface({
	gl,
	stateCache,
	texturedProgram,
	viewProjectionMatrix,
	surface,
	metrics,
	family,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	texturedProgram: Webgl2TexturedWorldProgram;
	viewProjectionMatrix: RenderMat4;
	surface: Webgl2MaterialDrawSurface;
	metrics: Webgl2WorldSubmitMetrics;
	family: StaticMaterialFamilyDescriptor;
}): Webgl2MaterialDrawResult {
	const material = surface.material;
	const base = resolveMaterialTextureBinding(material, "base-color");
	if (!base) {
		return createSkippedMaterialDrawResult({
			surface,
			reasonCode: "missing-base-color-binding",
			detail: "missing base-color texture binding",
		});
	}
	const detail = resolveMaterialDetailTextureBinding(material);
	if (stateCache.useProgram(texturedProgram.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
		gl.uniform1i(texturedProgram.uniforms.uTexture, 0);
		gl.uniform1i(texturedProgram.uniforms.uDetailTexture, 1);
		metrics.uniformUploadCount += 2;
	}
	applyWebgl2MaterialSurfaceState({ gl, stateCache, surface, metrics });
	if (stateCache.bindTexture2D(0, base.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(1, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		texturedProgram.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			surface.modelMatrix,
		),
	);
	gl.uniform4fv(
		texturedProgram.uniforms.uColor,
		resolveMaterialDrawColor(surface, family),
	);
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
	gl.uniform1f(
		texturedProgram.uniforms.uDetailTiling,
		material.detailOverlay?.tiling ?? 1,
	);
	gl.uniform1i(
		texturedProgram.uniforms.uDetailEnabled,
		detail && material.detailOverlay ? 1 : 0,
	);
	uploadTexturedDetailAtlasUniforms(gl, texturedProgram, detail);
	metrics.uniformUploadCount += 12;
	gl.drawElements(gl.TRIANGLES, surface.indexCount, surface.indexType, 0);
	return {
		status: "submitted",
		domain: surface.domain,
		triangleCount: surface.triangleCount,
		family,
	};
}

function submitWebgl2FlatMaterialDrawSurface({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	surface,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	viewProjectionMatrix: RenderMat4;
	surface: Webgl2MaterialDrawSurface;
	metrics: Webgl2WorldSubmitMetrics;
}): Webgl2MaterialDrawResult {
	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
	}
	applyWebgl2MaterialSurfaceState({ gl, stateCache, surface, metrics });
	gl.uniformMatrix4fv(
		program.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			surface.modelMatrix,
		),
	);
	gl.uniform4fv(
		program.uniforms.uColor,
		resolveMaterialDrawColor(surface, surface.material.family),
	);
	metrics.uniformUploadCount += 2;
	gl.drawElements(gl.TRIANGLES, surface.indexCount, surface.indexType, 0);
	return {
		status: "submitted",
		domain: surface.domain,
		triangleCount: surface.triangleCount,
		family: surface.material.family,
	};
}

function submitWebgl2IndexedMaterialDrawSurface({
	gl,
	stateCache,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	surface,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	surface: Webgl2MaterialDrawSurface;
	metrics: Webgl2WorldSubmitMetrics;
}): Webgl2MaterialDrawResult {
	const material = surface.material;
	const descriptor = material.indexedMaterial;
	const index = resolveMaterialTextureBinding(material, "indexed-texels");
	const palette = resolveMaterialTextureBinding(material, "palette-lookup");
	if (!descriptor || !index || !palette) {
		return createSkippedMaterialDrawResult({
			surface,
			reasonCode: "incomplete-indexed-bindings",
			detail: "incomplete indexed material bindings",
		});
	}
	if (index.indexedFormat !== descriptor.indexFormat) {
		return createSkippedMaterialDrawResult({
			surface,
			reasonCode: "indexed-format-mismatch",
			detail: `indexed format mismatch ${index.indexedFormat ?? "missing"} vs ${descriptor.indexFormat}`,
		});
	}
	const detail = resolveMaterialDetailTextureBinding(material);
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
	applyWebgl2MaterialSurfaceState({ gl, stateCache, surface, metrics });
	if (stateCache.bindTexture2D(0, index.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (stateCache.bindTexture2D(1, palette.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	if (detail && stateCache.bindTexture2D(2, detail.texture.texture)) {
		metrics.stateChangeCount += 1;
	}
	gl.uniformMatrix4fv(
		program.uniforms.uModelViewProjection,
		false,
		multiplyMat4Into(
			new Float32Array(16),
			viewProjectionMatrix,
			surface.modelMatrix,
		),
	);
	gl.uniform4fv(
		program.uniforms.uColor,
		resolveMaterialDrawColor(surface, material.family),
	);
	gl.uniform1f(program.uniforms.uAlphaTest, 0);
	gl.uniform2f(
		program.uniforms.uTextureSize,
		descriptor.width,
		descriptor.height,
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
	gl.uniform1i(program.uniforms.uRepeatS, descriptor.wrapS === "repeat" ? 1 : 0);
	gl.uniform1i(program.uniforms.uRepeatT, descriptor.wrapT === "repeat" ? 1 : 0);
	gl.uniform1f(
		program.uniforms.uDetailTiling,
		material.detailOverlay?.tiling ?? 1,
	);
	gl.uniform1i(
		program.uniforms.uDetailEnabled,
		detail && material.detailOverlay ? 1 : 0,
	);
	uploadIndexedDetailAtlasUniforms(gl, program, detail);
	metrics.uniformUploadCount += 15;
	gl.drawElements(gl.TRIANGLES, surface.indexCount, surface.indexType, 0);
	return {
		status: "submitted",
		domain: surface.domain,
		triangleCount: surface.triangleCount,
		family: material.family,
	};
}

function applyWebgl2MaterialSurfaceState({
	gl,
	stateCache,
	surface,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	surface: Webgl2MaterialDrawSurface;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: surface.depthWrite,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setCullState(surface.cull);
	if (stateCache.bindVertexArray(surface.vertexArray)) {
		metrics.vertexArrayBindCount += 1;
		metrics.stateChangeCount += 1;
	}
}

function createSkippedMaterialDrawResult({
	surface,
	reasonCode,
	detail,
}: {
	surface: Webgl2MaterialDrawSurface;
	reasonCode: string;
	detail: string;
}): Webgl2MaterialDrawResult {
	return {
		status: "skipped",
		domain: surface.domain,
		material: surface.material,
		reasonCode,
		detail,
		diagnosticParts: surface.diagnosticParts,
	};
}

function resolveMaterialDrawColor(
	surface: Webgl2MaterialDrawSurface,
	family: StaticMaterialFamilyDescriptor,
): readonly [number, number, number, number] {
	if (
		surface.colorPolicy === "white-for-textured-and-indexed" &&
		(family.kind === "texture-page" || family.kind === "indexed-paletted")
	) {
		return [1, 1, 1, 1];
	}
	return surface.material.color;
}

function recordWebgl2MaterialDrawResult(
	metrics: Webgl2WorldSubmitMetrics,
	result: Webgl2MaterialDrawResult,
): void {
	if (result.status === "submitted") {
		metrics.drawCallCount += 1;
		metrics.triangleCount += result.triangleCount;
		metrics.materialSurfaceSubmittedCount += 1;
		metrics.materialSurfaceSubmittedCountsByDomain[result.domain] += 1;
		metrics.materialSurfaceDrawCallCountsByDomain[result.domain] += 1;
		metrics.materialSurfaceTriangleCountsByDomain[result.domain] +=
			result.triangleCount;
		incrementCount(
			metrics.materialSurfaceSubmittedAlphaPolicyCounts,
			describeSubmittedMaterialAlphaPolicy(result.family),
		);
		return;
	}
	metrics.materialSurfaceSkippedCount += 1;
	metrics.materialSurfaceSkippedCountsByDomain[result.domain] += 1;
	incrementCount(metrics.materialSurfaceSkippedReasonCounts, result.reasonCode);
	incrementCount(
		metrics.materialSurfaceSkippedFamilyCounts,
		describeStaticBundleFamilySource(result.material.family),
	);
	incrementCount(
		metrics.materialSurfaceSkippedAlphaPolicyCounts,
		result.material.family.alphaPolicy ?? "none",
	);
	if (result.material.textureBindings.length === 0) {
		incrementCount(metrics.materialSurfaceSkippedBindingUsageCounts, "none");
	} else {
		for (const binding of result.material.textureBindings) {
			incrementCount(
				metrics.materialSurfaceSkippedBindingUsageCounts,
				binding.role,
			);
		}
	}
	metrics.materialSurfaceSubmitFallbackSamples =
		appendStaticBundleSubmitFallbackSamples(
			metrics.materialSurfaceSubmitFallbackSamples,
			[
				[
					result.reasonCode,
					result.detail,
					`domain ${result.domain}`,
					`material ${result.material.key}`,
					`family ${result.material.familyKey}`,
					`bindings ${describeStaticBundleMaterialBindings(result.material)}`,
					...result.diagnosticParts,
				].join("; "),
			],
		);
}

function describeSubmittedMaterialAlphaPolicy(
	family: StaticMaterialFamilyDescriptor,
): string {
	if (family.alphaPolicy === "cutout") {
		return "cutout";
	}
	if (
		family.alphaPolicy === "transparent-blend" ||
		family.alphaPolicy === "opacity-translucent"
	) {
		return "transparent";
	}
	return "opaque";
}

function submitWebgl2StaticMaterialByFamily<TResult>({
	material,
	submitIndexed,
	submitFlat,
	submitTexture,
	skipUnsupported,
}: {
	material: Webgl2StaticBundleMaterialResource;
	submitIndexed(): TResult;
	submitFlat(): TResult;
	submitTexture(family: StaticMaterialFamilyDescriptor): TResult;
	skipUnsupported(family: StaticMaterialFamilyDescriptor): TResult;
}): TResult {
	const family = material.family;
	if (isStaticBundleIndexedMaterialFamily(family)) {
		return submitIndexed();
	}
	if (isStaticBundleFlatMaterialFamily(family)) {
		return submitFlat();
	}
	if (isStaticBundleTextureMaterialFamily(family)) {
		return submitTexture(family);
	}
	return skipUnsupported(family);
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

function resolveMaterialTextureBinding(
	material: Webgl2StaticBundleMaterialResource,
	role: Webgl2StaticBundleMaterialTextureBinding["role"],
): Webgl2StaticBundleMaterialTextureBinding | null {
	return (
		material.textureBindings.find(
			(binding) => binding.role === role,
		) ?? null
	);
}

function resolveMaterialDetailTextureBinding(
	material: Webgl2StaticBundleMaterialResource,
): Webgl2StaticBundleMaterialTextureBinding | null {
	if (!material.detailOverlay) {
		return null;
	}
	return (
		material.textureBindings.find(
			(binding) => binding.virtualRefKey === material.detailOverlay?.textureRefKey,
		) ?? null
	);
}

function appendStaticBundleSubmitFallbackSamples(
	current: readonly string[],
	next: readonly string[],
): readonly string[] {
	return [...current, ...next].slice(0, 16);
}

function describeStaticBundleFamilySource(
	family: StaticMaterialFamilyDescriptor,
): string {
	return "sourceFamily" in family ? family.sourceFamily : family.kind;
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
				`${binding.role}/${binding.sampleClass}/${binding.wrapS}:${binding.wrapT}`,
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
			if (draw.kind !== WORLD_RENDER_DRAW_KIND.terrainTile) {
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
			if (draw.kind !== WORLD_RENDER_DRAW_KIND.staticBundleLayer) {
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
			if (draw.kind !== WORLD_RENDER_DRAW_KIND.transitionPortalMask) {
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
