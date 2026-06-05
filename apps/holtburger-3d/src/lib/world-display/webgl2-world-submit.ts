import {
	createTranslationMat4,
	multiplyMat4Into,
	type RenderMat4,
} from "./render-math";
import type { WorldRenderFrame } from "./world-render-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import {
	createDirectFamilyUniformCache,
	DIRECT_FAMILY_DRAW_TEXTURE_UNITS,
	planWebgl2DirectDrawRoute,
	prepareDirectIndexedPalettedDraw,
	prepareDirectRgbaTexturePageDraw,
	resetDirectFamilyUniformCache,
	uploadDirectColorUniforms,
	uploadDirectFamilySamplerUniforms,
	uploadDirectIndexedPalettedUniforms,
	uploadDirectRgbaTexturePageUniforms,
	type DirectFamilyDrawContext,
	type Webgl2DirectDrawPrograms,
	type Webgl2DirectProgramKind,
} from "./webgl2/families/direct-family-adapters";
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
	visibleDrawUnitCount: number;
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
	portalMaskDrawUnitCount: number;
	exteriorDomainDrawUnitCount: number;
	interiorDomainDrawUnitCount: number;
	submittedTerrainTileCount: number;
	terrainSubmittedTriangleCount: number;
	retainedDirectOpaqueDrawUnitCount: number;
	retainedDirectBlendedDrawUnitCount: number;
	drawCallCount: number;
	programSwitchCount: number;
	vertexArrayBindCount: number;
	uniformUploadCount: number;
	stateChangeCount: number;
	triangleCount: number;
	visibleDrawUnitCountsByMaterialKind: Readonly<Record<string, number>>;
	visibleRetainedDirectDrawUnitCountsByCompactionFamily: Readonly<
		Record<string, number>
	>;
	directTexturePageDrawCount: number;
	directSingleEntryTexturePageDrawCount: number;
	directPackedTexturePageDrawCount: number;
	directPackedTexturePageEstimatedBindAvoidedCount: number;
	directTexturePageFallbackSamples: readonly string[];
	staticBundleLayerSubmittedCount: number;
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
	visibleDrawUnitCount: 0,
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
	portalMaskDrawUnitCount: 0,
	exteriorDomainDrawUnitCount: 0,
	interiorDomainDrawUnitCount: 0,
	submittedTerrainTileCount: 0,
	terrainSubmittedTriangleCount: 0,
	retainedDirectOpaqueDrawUnitCount: 0,
	retainedDirectBlendedDrawUnitCount: 0,
	drawCallCount: 0,
	programSwitchCount: 0,
	vertexArrayBindCount: 0,
	uniformUploadCount: 0,
	stateChangeCount: 0,
	triangleCount: 0,
	visibleDrawUnitCountsByMaterialKind: {},
	visibleRetainedDirectDrawUnitCountsByCompactionFamily: {},
	directTexturePageDrawCount: 0,
	directSingleEntryTexturePageDrawCount: 0,
	directPackedTexturePageDrawCount: 0,
	directPackedTexturePageEstimatedBindAvoidedCount: 0,
	directTexturePageFallbackSamples: [],
	staticBundleLayerSubmittedCount: 0,
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

interface Webgl2RetainedDirectSubmitPass {
	kind: "retained-direct";
	alphaPolicy: "opaque-or-cutout" | "transparent-blend";
	drawUnits: readonly Webgl2WorldDrawUnit[];
}

type Webgl2WorldSubmitPass = Webgl2RetainedDirectSubmitPass;

export interface Webgl2WorldSubmitPassSchedule {
	passes: readonly Webgl2WorldSubmitPass[];
	retainedDrawUnits: readonly Webgl2WorldDrawUnit[];
	retainedDirectOpaqueDrawUnitCount: number;
	retainedDirectBlendedDrawUnitCount: number;
}

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
		visibleDrawUnitCountsByMaterialKind: {},
		directTexturePageFallbackSamples: [],
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
	drawUnitsById,
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
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>;
	terrainTilesById?: ReadonlyMap<string, Webgl2TerrainTileResource>;
	frame: WorldRenderFrame;
}): Webgl2WorldSubmitMetrics {
	const drawUnits = planWebgl2WorldSubmitOrder(frame, drawUnitsById);
	const terrainTiles = planWebgl2TerrainTileSubmitOrder(
		frame,
		terrainTilesById,
	);
	const portalMaskDrawUnits = planWebgl2PortalMaskSubmitOrder(
		frame,
		drawUnitsById,
	);
	const sceneDomainDrawUnits = partitionWebgl2SceneDomainDrawUnits(drawUnits);
	return submitWebgl2WorldDrawUnits({
		gl,
		stateCache,
		program,
		texturedProgram,
		terrainFamilyProgram,
		indexedP8Program,
		indexedP16Program,
		staticBundleLayerResources,
		structuredInteriorResources,
		viewProjectionMatrix: frame.viewProjectionMatrix,
		cameraPosition: frame.cameraFrame.position,
		drawUnits,
		terrainTiles,
		portalMaskDrawUnitCount: portalMaskDrawUnits.length,
		exteriorDomainDrawUnitCount: sceneDomainDrawUnits.exterior.length,
		interiorDomainDrawUnitCount: sceneDomainDrawUnits.interior.length,
	});
}

export function submitWebgl2WorldDrawUnits({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainFamilyProgram,
	indexedP8Program,
	indexedP16Program,
	staticBundleLayerResources = null,
	structuredInteriorResources = null,
	viewProjectionMatrix,
	cameraPosition,
	drawUnits,
	terrainTiles = [],
	portalMaskDrawUnitCount = 0,
	exteriorDomainDrawUnitCount = 0,
	interiorDomainDrawUnitCount = 0,
	terrainBackfaceCulling = false,
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
	viewProjectionMatrix: RenderMat4;
	cameraPosition: WorldRenderFrame["cameraFrame"]["position"];
	drawUnits: readonly Webgl2WorldDrawUnit[];
	terrainTiles?: readonly Webgl2TerrainTileResource[];
	portalMaskDrawUnitCount?: number;
	exteriorDomainDrawUnitCount?: number;
	interiorDomainDrawUnitCount?: number;
	terrainBackfaceCulling?: boolean;
}): Webgl2WorldSubmitMetrics {
	const terrainReadinessPlan =
		planWebgl2TerrainTileSubmitReadiness(terrainTiles);
	const metrics: Webgl2WorldSubmitMetrics = {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCount: drawUnits.length,
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
		portalMaskDrawUnitCount,
		exteriorDomainDrawUnitCount,
		interiorDomainDrawUnitCount,
		visibleDrawUnitCountsByMaterialKind:
			countDrawUnitsByMaterialKind(drawUnits),
		visibleRetainedDirectDrawUnitCountsByCompactionFamily: {},
	};
	if (drawUnits.length === 0 && terrainTiles.length === 0) {
		if (
			!staticBundleLayerResources?.layersByKey.size &&
			!structuredInteriorResources?.cellsByKey.size
		) {
			return metrics;
		}
	}
	const schedule = planWebgl2WorldSubmitPassSchedule({
		drawUnits,
		viewProjectionMatrix,
	});
	metrics.retainedDirectOpaqueDrawUnitCount =
		schedule.retainedDirectOpaqueDrawUnitCount;
	metrics.retainedDirectBlendedDrawUnitCount =
		schedule.retainedDirectBlendedDrawUnitCount;
	metrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily =
		countDrawUnitsByCompactionFamily(schedule.retainedDrawUnits);
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
	submitWebgl2WorldSubmitPassSchedule({
		gl,
		stateCache,
		program,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		schedule,
		metrics,
	});
	submitWebgl2StaticBundleLayers({
		gl,
		stateCache,
		texturedProgram,
		indexedP8Program,
		indexedP16Program,
		viewProjectionMatrix,
		staticBundleLayerResources,
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
	staticBundleLayerResources,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	staticBundleLayerResources: Webgl2StaticBundleLayerResourceStore | null;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!staticBundleLayerResources) {
		return;
	}
	const identityMatrix = createTranslationMat4({ x: 0, y: 0, z: 0 });
	for (const layer of staticBundleLayerResources.layersByKey.values()) {
		const materialByKey = new Map(
			layer.materialRecords.map((material) => [material.key, material]),
		);
		const geometries = [...layer.compactedBatches, ...layer.directEntries].sort(
			(left, right) => left.key.localeCompare(right.key),
		);
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
						identityMatrix,
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
			if (cell.materialSlices.length === 0) {
				if (!transparent && cell.fallbackShell) {
					submitWebgl2StructuredInteriorShell({
						gl,
						stateCache,
						program,
						viewProjectionMatrix,
						cell,
						shell: cell.fallbackShell,
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
					metrics,
				});
			}
		}
	}
}

function submitWebgl2StructuredInteriorShell({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	cell,
	shell,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	viewProjectionMatrix: RenderMat4;
	cell: Webgl2StructuredInteriorCellResource;
	shell: Webgl2StructuredInteriorShellResource;
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
			cell.modelMatrix,
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
			cell.modelMatrix,
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
			cell.modelMatrix,
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
	identityMatrix,
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
	identityMatrix: RenderMat4;
	layer: Webgl2StaticBundleLayerResource;
	geometry: Webgl2StaticBundleGeometryResource;
	material: Webgl2StaticBundleMaterialResource;
	metrics: Webgl2WorldSubmitMetrics;
}): boolean {
	if (material.familyKey === "indexed-paletted") {
		return submitWebgl2IndexedStaticBundleGeometry({
			gl,
			stateCache,
			indexedP8Program,
			indexedP16Program,
			viewProjectionMatrix,
			identityMatrix,
			layer,
			geometry,
			material,
			metrics,
		});
	}
	if (material.familyKey !== "rgba-texture-page") {
		metrics.staticBundleSkippedGeometryCount += 1;
		metrics.staticBundleSubmitFallbackSamples =
			appendStaticBundleSubmitFallbackSamples(
				metrics.staticBundleSubmitFallbackSamples,
				[
					`static bundle ${layer.layerKey} material ${material.key} family ${material.familyKey} is not submitted by the RGBA slice`,
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
					`static bundle ${layer.layerKey} material ${material.key} has no base-color texture binding`,
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
			identityMatrix,
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

function submitWebgl2IndexedStaticBundleGeometry({
	gl,
	stateCache,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	identityMatrix,
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
	identityMatrix: RenderMat4;
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
					`static bundle ${layer.layerKey} material ${material.key} has incomplete indexed material bindings`,
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
					`static bundle ${layer.layerKey} material ${material.key} indexed format ${index.indexedFormat ?? "missing"} does not match descriptor ${descriptor.indexFormat}`,
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
			identityMatrix,
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

export function planWebgl2WorldSubmitPassSchedule({
	drawUnits,
	viewProjectionMatrix,
}: {
	drawUnits: readonly Webgl2WorldDrawUnit[];
	viewProjectionMatrix: RenderMat4;
}): Webgl2WorldSubmitPassSchedule {
	const retainedDirectPasses = partitionRetainedDirectDrawUnits({
		drawUnits,
		viewProjectionMatrix,
	});
	const passes: Webgl2WorldSubmitPass[] = [];
	if (retainedDirectPasses.opaque.length > 0) {
		passes.push({
			kind: "retained-direct",
			alphaPolicy: "opaque-or-cutout",
			drawUnits: retainedDirectPasses.opaque,
		});
	}
	if (retainedDirectPasses.blended.length > 0) {
		passes.push({
			kind: "retained-direct",
			alphaPolicy: "transparent-blend",
			drawUnits: retainedDirectPasses.blended,
		});
	}
	return {
		passes,
		retainedDrawUnits: drawUnits,
		retainedDirectOpaqueDrawUnitCount: retainedDirectPasses.opaque.length,
		retainedDirectBlendedDrawUnitCount: retainedDirectPasses.blended.length,
	};
}

function submitWebgl2WorldSubmitPassSchedule({
	gl,
	stateCache,
	program,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
	viewProjectionMatrix,
	schedule,
	metrics,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	viewProjectionMatrix: RenderMat4;
	schedule: Webgl2WorldSubmitPassSchedule;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	let directSubmitContext: Webgl2DirectSubmitContext | null = null;
	for (const pass of schedule.passes) {
		switch (pass.kind) {
			case "retained-direct":
				directSubmitContext ??= createWebgl2DirectSubmitContext({
					gl,
					stateCache,
					viewProjectionMatrix,
					program,
					texturedProgram,
					indexedP8Program,
					indexedP16Program,
				});
				submitWebgl2DirectDrawUnitPass({
					context: directSubmitContext,
					drawUnits: pass.drawUnits,
					metrics,
				});
				break;
		}
	}
}

function resetWorldSubmitExitRenderState({
	gl,
	stateCache,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
}): number {
	let changeCount = stateCache.setDepthState({
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

interface Webgl2DirectSubmitContext {
	directContext: DirectFamilyDrawContext;
	directPrograms: Webgl2DirectDrawPrograms;
	uniformCache: ReturnType<typeof createDirectFamilyUniformCache>;
	previousProgramKind: Webgl2DirectProgramKind | null;
}

function createWebgl2DirectSubmitContext({
	gl,
	stateCache,
	viewProjectionMatrix,
	program,
	texturedProgram,
	indexedP8Program,
	indexedP16Program,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	viewProjectionMatrix: RenderMat4;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
}): Webgl2DirectSubmitContext {
	const uniformCache = createDirectFamilyUniformCache();
	const directContext: DirectFamilyDrawContext = {
		gl,
		stateCache,
		viewProjectionMatrix,
		textureUnits: DIRECT_FAMILY_DRAW_TEXTURE_UNITS,
	};
	const directPrograms: Webgl2DirectDrawPrograms = {
		flat: program,
		rgbaTexturePage: texturedProgram,
		indexedP8: indexedP8Program,
		indexedP16: indexedP16Program,
	};
	return {
		directContext,
		directPrograms,
		uniformCache,
		previousProgramKind: null,
	};
}

function submitWebgl2DirectDrawUnitPass({
	context,
	drawUnits,
	metrics,
}: {
	context: Webgl2DirectSubmitContext;
	drawUnits: readonly Webgl2WorldDrawUnit[];
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	const modelViewProjection = new Float32Array(16);
	for (const drawUnit of drawUnits) {
		const route = planWebgl2DirectDrawRoute({
			drawUnit,
			programs: context.directPrograms,
		});
		if (
			context.directContext.stateCache.useProgram(route.activeProgram.program)
		) {
			metrics.programSwitchCount += 1;
			metrics.stateChangeCount += 1;
			resetDirectFamilyUniformCache(context.uniformCache);
			context.previousProgramKind = route.programKind;
			uploadDirectFamilySamplerUniforms({
				context: context.directContext,
				route,
				metrics,
			});
		} else if (context.previousProgramKind !== route.programKind) {
			resetDirectFamilyUniformCache(context.uniformCache);
			context.previousProgramKind = route.programKind;
		}
		metrics.stateChangeCount += applyDrawUnitRenderState({
			gl: context.directContext.gl,
			stateCache: context.directContext.stateCache,
			drawUnit,
		});
		metrics.stateChangeCount += context.directContext.stateCache.setCullState({
			enabled: false,
			mode: context.directContext.gl.BACK,
		});
		if (route.programKind === "texture") {
			prepareDirectRgbaTexturePageDraw({
				context: context.directContext,
				route,
				metrics,
			});
		}
		if (
			route.programKind === "indexed-p8" ||
			route.programKind === "indexed-p16"
		) {
			prepareDirectIndexedPalettedDraw({
				context: context.directContext,
				route,
				metrics,
			});
		}
		if (
			context.directContext.stateCache.bindVertexArray(
				drawUnit.vertexArray.vertexArray,
			)
		) {
			metrics.vertexArrayBindCount += 1;
			metrics.stateChangeCount += 1;
		}

		multiplyMat4Into(
			modelViewProjection,
			context.directContext.viewProjectionMatrix,
			drawUnit.modelMatrix,
		);
		if (
			!context.uniformCache.modelViewProjectionValid ||
			!arraysEqual(
				context.uniformCache.modelViewProjection,
				modelViewProjection,
			)
		) {
			context.directContext.gl.uniformMatrix4fv(
				route.activeProgram.uniforms.uModelViewProjection,
				false,
				modelViewProjection,
			);
			context.uniformCache.modelViewProjection.set(modelViewProjection);
			context.uniformCache.modelViewProjectionValid = true;
			metrics.uniformUploadCount += 1;
		}
		if (route.programKind === "texture") {
			uploadDirectRgbaTexturePageUniforms({
				context: context.directContext,
				route,
				uniformCache: context.uniformCache,
				metrics,
			});
		} else if (
			route.programKind === "indexed-p8" ||
			route.programKind === "indexed-p16"
		) {
			uploadDirectIndexedPalettedUniforms({
				context: context.directContext,
				route,
				uniformCache: context.uniformCache,
				metrics,
			});
		} else {
			uploadDirectColorUniforms({
				context: context.directContext,
				route,
				uniformCache: context.uniformCache,
				metrics,
			});
		}
		context.directContext.gl.drawElements(
			context.directContext.gl.TRIANGLES,
			drawUnit.vertexCount,
			drawUnit.indexType,
			0,
		);
		metrics.drawCallCount += 1;
		metrics.triangleCount += drawUnit.triangleCount;
	}
}

export function planWebgl2WorldSubmitOrder(
	frame: WorldRenderFrame,
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): Webgl2WorldDrawUnit[] {
	const visibleDrawUnits: Webgl2WorldDrawUnit[] = [];
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			if (draw.kind !== "draw-unit") {
				continue;
			}
			const drawUnit = drawUnitsById.get(draw.drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`World render frame referenced missing WebGL2 draw unit ${draw.drawUnitId}.`,
				);
			}
			if (drawUnit.kind !== "portal-mask") {
				visibleDrawUnits.push(drawUnit);
			}
		}
	}
	return visibleDrawUnits.sort(compareWebgl2WorldDrawUnits);
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

export function planWebgl2PortalMaskSubmitOrder(
	frame: WorldRenderFrame,
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): Webgl2WorldDrawUnit[] {
	const maskDrawUnits: Webgl2WorldDrawUnit[] = [];
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			if (draw.kind !== "draw-unit") {
				continue;
			}
			const drawUnit = drawUnitsById.get(draw.drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`World render frame referenced missing WebGL2 draw unit ${draw.drawUnitId}.`,
				);
			}
			if (drawUnit.kind === "portal-mask") {
				maskDrawUnits.push(drawUnit);
			}
		}
	}
	return maskDrawUnits.sort((left, right) =>
		compareStableAsciiStrings(left.id, right.id),
	);
}

export interface Webgl2SceneDomainDrawUnits {
	exterior: Webgl2WorldDrawUnit[];
	interior: Webgl2WorldDrawUnit[];
}

export function partitionWebgl2SceneDomainDrawUnits(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): Webgl2SceneDomainDrawUnits {
	const exterior: Webgl2WorldDrawUnit[] = [];
	const interior: Webgl2WorldDrawUnit[] = [];
	for (const drawUnit of drawUnits) {
		switch (drawUnit.sceneDomain) {
			case "exterior":
				exterior.push(drawUnit);
				break;
			case "interior":
				interior.push(drawUnit);
				break;
			case null:
				break;
			default:
				assertNeverWebgl2SceneDomain(drawUnit.sceneDomain);
		}
	}
	return { exterior, interior };
}

function assertNeverWebgl2SceneDomain(domain: never): never {
	throw new Error(`Unsupported WebGL2 scene domain ${domain}.`);
}

function compareWebgl2WorldDrawUnits(
	left: Webgl2WorldDrawUnit,
	right: Webgl2WorldDrawUnit,
): number {
	return compareStableAsciiStrings(left.submitOrderKey, right.submitOrderKey);
}

interface RetainedDirectDrawUnitPasses {
	opaque: readonly Webgl2WorldDrawUnit[];
	blended: readonly Webgl2WorldDrawUnit[];
}

function partitionRetainedDirectDrawUnits({
	drawUnits,
	viewProjectionMatrix,
}: {
	drawUnits: readonly Webgl2WorldDrawUnit[];
	viewProjectionMatrix: RenderMat4;
}): RetainedDirectDrawUnitPasses {
	const opaque: Webgl2WorldDrawUnit[] = [];
	const blended: Webgl2WorldDrawUnit[] = [];
	for (const drawUnit of drawUnits) {
		if (isBlendedDrawUnit(drawUnit)) {
			blended.push(drawUnit);
		} else {
			opaque.push(drawUnit);
		}
	}
	blended.sort((left, right) =>
		compareRetainedBlendedDrawUnits(left, right, viewProjectionMatrix),
	);
	return { opaque, blended };
}

function isBlendedDrawUnit(drawUnit: Webgl2WorldDrawUnit): boolean {
	return drawUnit.materialBehavior?.blend.enabled === true;
}

function compareRetainedBlendedDrawUnits(
	left: Webgl2WorldDrawUnit,
	right: Webgl2WorldDrawUnit,
	viewProjectionMatrix: RenderMat4,
): number {
	const depthDelta =
		calculateProjectedOriginDepth(right, viewProjectionMatrix) -
		calculateProjectedOriginDepth(left, viewProjectionMatrix);
	if (Number.isFinite(depthDelta) && depthDelta !== 0) {
		return depthDelta;
	}
	return compareStableAsciiStrings(left.submitOrderKey, right.submitOrderKey);
}

function calculateProjectedOriginDepth(
	drawUnit: Webgl2WorldDrawUnit,
	viewProjectionMatrix: RenderMat4,
): number {
	const modelMatrix = drawUnit.modelMatrix;
	const worldX = modelMatrix[12] ?? 0;
	const worldY = modelMatrix[13] ?? 0;
	const worldZ = modelMatrix[14] ?? 0;
	const clipZ =
		(viewProjectionMatrix[2] ?? 0) * worldX +
		(viewProjectionMatrix[6] ?? 0) * worldY +
		(viewProjectionMatrix[10] ?? 0) * worldZ +
		(viewProjectionMatrix[14] ?? 0);
	const clipW =
		(viewProjectionMatrix[3] ?? 0) * worldX +
		(viewProjectionMatrix[7] ?? 0) * worldY +
		(viewProjectionMatrix[11] ?? 0) * worldZ +
		(viewProjectionMatrix[15] ?? 1);
	const projectedDepth = clipW === 0 ? clipZ : clipZ / clipW;
	return Number.isFinite(projectedDepth) ? projectedDepth : 0;
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

function applyDrawUnitRenderState({
	gl,
	stateCache,
	drawUnit,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	drawUnit: Webgl2WorldDrawUnit;
}): number {
	const behavior = drawUnit.materialBehavior;
	const blend = behavior?.blend;
	let changeCount = stateCache.setDepthState({
		enabled: true,
		write: blend?.depthWrite ?? true,
		func: gl.LEQUAL,
	});
	if (blend?.enabled) {
		changeCount += stateCache.setBlendState({
			enabled: true,
			srcRgb: toWebgl2BlendFactor(gl, blend.srcFactor),
			dstRgb: toWebgl2BlendFactor(gl, blend.dstFactor),
			srcAlpha: toWebgl2BlendFactor(gl, blend.srcFactor),
			dstAlpha: toWebgl2BlendFactor(gl, blend.dstFactor),
			equationRgb: gl.FUNC_ADD,
			equationAlpha: gl.FUNC_ADD,
		});
		return changeCount;
	}
	changeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	return changeCount;
}

function toWebgl2BlendFactor(
	gl: WebGL2RenderingContext,
	factor: string | null | undefined,
): GLenum {
	switch (factor) {
		case "one":
			return gl.ONE;
		case "src-alpha":
			return gl.SRC_ALPHA;
		case "one-minus-src-alpha":
			return gl.ONE_MINUS_SRC_ALPHA;
		case null:
		case undefined:
			return gl.ONE;
		default:
			throw new Error(`Unsupported WebGL2 blend factor ${factor}.`);
	}
}

function countDrawUnitsByMaterialKind(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const drawUnit of drawUnits) {
		counts[drawUnit.materialKind] = (counts[drawUnit.materialKind] ?? 0) + 1;
	}
	return counts;
}

function countDrawUnitsByCompactionFamily(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const drawUnit of drawUnits) {
		const family = drawUnit.compactionEligibility.material.family;
		counts[family] = (counts[family] ?? 0) + 1;
	}
	return counts;
}

function arraysEqual(
	left: ArrayLike<number>,
	right: ArrayLike<number>,
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}
