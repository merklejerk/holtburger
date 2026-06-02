import { multiplyMat4, type RenderMat4 } from "./render-math";
import type { StagedWorldFrame } from "./staged-world-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
import {
	createEmptyWebgl2RgbaTexturePageFamilySubmitMetrics,
	planWebgl2RgbaTexturePageFamilyReplacement,
	submitWebgl2RgbaTexturePageFamilyBatches,
	type Webgl2RgbaTexturePageFamilySubmitResources,
	type Webgl2RgbaTexturePageFamilyWorldProgram,
} from "./webgl2-rgba-texture-page-family-submit";
import {
	createEmptyWebgl2IndexedPalettedFamilySubmitMetrics,
	planWebgl2IndexedPalettedFamilyReplacement,
	submitWebgl2IndexedPalettedFamilyBatches,
	type Webgl2IndexedPalettedFamilySubmitResources,
	type Webgl2IndexedPalettedFamilyWorldProgram,
} from "./webgl2-indexed-paletted-family-submit";
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
} from "./webgl2-direct-family-adapters";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";

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
export type Webgl2TerrainBlendWorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	| "uModelViewProjection"
	| "uBaseTexture"
	| "uBaseTiling"
	| "uOverlay0"
	| "uOverlay1"
	| "uOverlay2"
	| "uOverlayAlpha0"
	| "uOverlayAlpha1"
	| "uOverlayAlpha2"
	| "uOverlayTiling0"
	| "uOverlayTiling1"
	| "uOverlayTiling2"
	| "uOverlayRotation0"
	| "uOverlayRotation1"
	| "uOverlayRotation2"
	| "uOverlayCount"
	| "uRoadTexture"
	| "uRoadTiling"
	| "uRoadAlpha0"
	| "uRoadAlpha1"
	| "uRoadRotation0"
	| "uRoadRotation1"
	| "uRoadCount"
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
	portalMaskDrawUnitCount: number;
	exteriorDomainDrawUnitCount: number;
	interiorDomainDrawUnitCount: number;
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
	rgbaTexturePageFamilyShaderDrawCallCount: number;
	rgbaTexturePageFamilySubmittedBatchCount: number;
	rgbaTexturePageFamilySubmittedDrawSliceCount: number;
	rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount: number;
	rgbaTexturePageFamilySubmittedTriangleCount: number;
	rgbaTexturePageFamilyReplacedDrawUnitCount: number;
	rgbaTexturePageFamilyReplacedDrawUnitTriangleCount: number;
	rgbaTexturePageFamilyConservativeOverdrawTriangleCount: number;
	rgbaTexturePageFamilyConservativeOverdrawRatio: number;
	rgbaTexturePageFamilyRetainedDirectDrawUnitCount: number;
	rgbaTexturePageFamilyOriginalDrawCallEstimateCount: number;
	rgbaTexturePageFamilySubmittedDrawCallEstimateCount: number;
	rgbaTexturePageFamilyDrawCallSavingsCount: number;
	rgbaTexturePageFamilyNoVisibleRouteCount: number;
	rgbaTexturePageFamilyNoVisibleExteriorRouteCount: number;
	rgbaTexturePageFamilyNoVisibleInteriorRouteCount: number;
	rgbaTexturePageFamilyNoVisibleOtherRouteCount: number;
	rgbaTexturePageFamilyFallbackSamples: readonly string[];
	indexedPalettedFamilyShaderDrawCallCount: number;
	indexedPalettedFamilySubmittedBatchCount: number;
	indexedPalettedFamilySubmittedDrawSliceCount: number;
	indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount: number;
	indexedPalettedFamilySubmittedTriangleCount: number;
	indexedPalettedFamilyReplacedDrawUnitCount: number;
	indexedPalettedFamilyReplacedDrawUnitTriangleCount: number;
	indexedPalettedFamilyRetainedDirectDrawUnitCount: number;
	indexedPalettedFamilyNoVisibleRouteCount: number;
	directTexturePageDrawCount: number;
	directSingleEntryTexturePageDrawCount: number;
	directPackedTexturePageDrawCount: number;
	directPackedTexturePageEstimatedBindAvoidedCount: number;
	directPackedTexturePageTextureCount: number;
	directTexturePageFallbackSamples: readonly string[];
}

const EMPTY_SUBMIT_METRICS: Webgl2WorldSubmitMetrics = {
	visibleDrawUnitCount: 0,
	portalMaskDrawUnitCount: 0,
	exteriorDomainDrawUnitCount: 0,
	interiorDomainDrawUnitCount: 0,
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
	rgbaTexturePageFamilyShaderDrawCallCount: 0,
	rgbaTexturePageFamilySubmittedBatchCount: 0,
	rgbaTexturePageFamilySubmittedDrawSliceCount: 0,
	rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount: 0,
	rgbaTexturePageFamilySubmittedTriangleCount: 0,
	rgbaTexturePageFamilyReplacedDrawUnitCount: 0,
	rgbaTexturePageFamilyReplacedDrawUnitTriangleCount: 0,
	rgbaTexturePageFamilyConservativeOverdrawTriangleCount: 0,
	rgbaTexturePageFamilyConservativeOverdrawRatio: 0,
	rgbaTexturePageFamilyRetainedDirectDrawUnitCount: 0,
	rgbaTexturePageFamilyOriginalDrawCallEstimateCount: 0,
	rgbaTexturePageFamilySubmittedDrawCallEstimateCount: 0,
	rgbaTexturePageFamilyDrawCallSavingsCount: 0,
	rgbaTexturePageFamilyNoVisibleRouteCount: 0,
	rgbaTexturePageFamilyNoVisibleExteriorRouteCount: 0,
	rgbaTexturePageFamilyNoVisibleInteriorRouteCount: 0,
	rgbaTexturePageFamilyNoVisibleOtherRouteCount: 0,
	rgbaTexturePageFamilyFallbackSamples: [],
	indexedPalettedFamilyShaderDrawCallCount: 0,
	indexedPalettedFamilySubmittedBatchCount: 0,
	indexedPalettedFamilySubmittedDrawSliceCount: 0,
	indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount: 0,
	indexedPalettedFamilySubmittedTriangleCount: 0,
	indexedPalettedFamilyReplacedDrawUnitCount: 0,
	indexedPalettedFamilyReplacedDrawUnitTriangleCount: 0,
	indexedPalettedFamilyRetainedDirectDrawUnitCount: 0,
	indexedPalettedFamilyNoVisibleRouteCount: 0,
	directTexturePageDrawCount: 0,
	directSingleEntryTexturePageDrawCount: 0,
	directPackedTexturePageDrawCount: 0,
	directPackedTexturePageEstimatedBindAvoidedCount: 0,
	directPackedTexturePageTextureCount: 0,
	directTexturePageFallbackSamples: [],
};

export type Webgl2RgbaTexturePageFamilySubmitRoute =
	| "flat-world"
	| "scene-domain-exterior"
	| "scene-domain-interior";

export function createEmptyWebgl2WorldSubmitMetrics(): Webgl2WorldSubmitMetrics {
	return {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCountsByMaterialKind: {},
		rgbaTexturePageFamilyFallbackSamples: [],
		directTexturePageFallbackSamples: [],
	};
}

export function submitWebgl2FlatWorldFrame({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainBlendProgram,
	indexedP8Program,
	indexedP16Program,
	rgbaTexturePageFamilyProgram,
	indexedPalettedFamilyP8Program,
	indexedPalettedFamilyP16Program,
	rgbaTexturePageFamilyResources = {
		batches: [],
		rgbaTexturePageFamilies: [],
		generation: null,
	},
	indexedPalettedFamilyResources = {
		batches: [],
		indexedPalettedFamilies: [],
		texturesByKey: new Map(),
		detailTextures: [],
	},
	drawUnitsById,
	frame,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	rgbaTexturePageFamilyProgram?: Webgl2RgbaTexturePageFamilyWorldProgram;
	indexedPalettedFamilyP8Program?: Webgl2IndexedPalettedFamilyWorldProgram;
	indexedPalettedFamilyP16Program?: Webgl2IndexedPalettedFamilyWorldProgram;
	rgbaTexturePageFamilyResources?: Webgl2RgbaTexturePageFamilySubmitResources;
	indexedPalettedFamilyResources?: Webgl2IndexedPalettedFamilySubmitResources;
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>;
	frame: StagedWorldFrame;
}): Webgl2WorldSubmitMetrics {
	const drawUnits = planWebgl2FlatWorldSubmitOrder(frame, drawUnitsById);
	const portalMaskDrawUnits = planWebgl2PortalMaskSubmitOrder(
		frame,
		drawUnitsById,
	);
	const sceneDomainDrawUnits = partitionWebgl2SceneDomainDrawUnits(drawUnits);
	return submitWebgl2FlatWorldDrawUnits({
		gl,
		stateCache,
		program,
		texturedProgram,
		terrainBlendProgram,
		indexedP8Program,
		indexedP16Program,
		rgbaTexturePageFamilyProgram,
		indexedPalettedFamilyP8Program,
		indexedPalettedFamilyP16Program,
		rgbaTexturePageFamilyResources,
		indexedPalettedFamilyResources,
		viewProjectionMatrix: frame.viewProjectionMatrix,
		drawUnits,
		portalMaskDrawUnitCount: portalMaskDrawUnits.length,
		exteriorDomainDrawUnitCount: sceneDomainDrawUnits.exterior.length,
		interiorDomainDrawUnitCount: sceneDomainDrawUnits.interior.length,
	});
}

export function submitWebgl2FlatWorldDrawUnits({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainBlendProgram,
	indexedP8Program,
	indexedP16Program,
	rgbaTexturePageFamilyProgram,
	indexedPalettedFamilyP8Program,
	indexedPalettedFamilyP16Program,
	rgbaTexturePageFamilyResources = {
		batches: [],
		rgbaTexturePageFamilies: [],
		generation: null,
	},
	indexedPalettedFamilyResources = {
		batches: [],
		indexedPalettedFamilies: [],
		texturesByKey: new Map(),
		detailTextures: [],
	},
	viewProjectionMatrix,
	drawUnits,
	portalMaskDrawUnitCount = 0,
	exteriorDomainDrawUnitCount = 0,
	interiorDomainDrawUnitCount = 0,
	rgbaTexturePageFamilySubmitRoute = "flat-world",
	terrainBackfaceCulling = false,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	rgbaTexturePageFamilyProgram?: Webgl2RgbaTexturePageFamilyWorldProgram;
	indexedPalettedFamilyP8Program?: Webgl2IndexedPalettedFamilyWorldProgram;
	indexedPalettedFamilyP16Program?: Webgl2IndexedPalettedFamilyWorldProgram;
	rgbaTexturePageFamilyResources?: Webgl2RgbaTexturePageFamilySubmitResources;
	indexedPalettedFamilyResources?: Webgl2IndexedPalettedFamilySubmitResources;
	viewProjectionMatrix: RenderMat4;
	drawUnits: readonly Webgl2WorldDrawUnit[];
	portalMaskDrawUnitCount?: number;
	exteriorDomainDrawUnitCount?: number;
	interiorDomainDrawUnitCount?: number;
	rgbaTexturePageFamilySubmitRoute?: Webgl2RgbaTexturePageFamilySubmitRoute;
	terrainBackfaceCulling?: boolean;
}): Webgl2WorldSubmitMetrics {
	const metrics: Webgl2WorldSubmitMetrics = {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCount: drawUnits.length,
		portalMaskDrawUnitCount,
		exteriorDomainDrawUnitCount,
		interiorDomainDrawUnitCount,
		visibleDrawUnitCountsByMaterialKind:
			countDrawUnitsByMaterialKind(drawUnits),
		visibleRetainedDirectDrawUnitCountsByCompactionFamily: {},
		directPackedTexturePageTextureCount:
			rgbaTexturePageFamilyResources.generation?.textures.length ?? 0,
	};
	if (drawUnits.length === 0) {
		return metrics;
	}
	const atlasReplacement = planWebgl2RgbaTexturePageFamilyReplacement({
		visibleDrawUnitIds: drawUnits.map((drawUnit) => drawUnit.id),
		resources: rgbaTexturePageFamilyResources,
	});
	const indexedReplacement = planWebgl2IndexedPalettedFamilyReplacement({
		visibleDrawUnitIds: drawUnits.map((drawUnit) => drawUnit.id),
		resources: indexedPalettedFamilyResources,
	});
	const compactedReplacementDrawUnitIds = new Set([
		...atlasReplacement.replaceableDrawUnitIds,
		...indexedReplacement.replaceableDrawUnitIds,
	]);
	const stagedDrawUnits =
		compactedReplacementDrawUnitIds.size === 0
			? drawUnits
			: drawUnits.filter(
					(drawUnit) =>
						!compactedReplacementDrawUnitIds.has(drawUnit.id),
				);
	const retainedDrawUnitCount = stagedDrawUnits.length;
	const directPasses = partitionRetainedDirectDrawUnits({
		drawUnits: stagedDrawUnits,
		viewProjectionMatrix,
	});
	metrics.retainedDirectOpaqueDrawUnitCount = directPasses.opaque.length;
	metrics.retainedDirectBlendedDrawUnitCount = directPasses.blended.length;
	metrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily =
		countDrawUnitsByCompactionFamily(stagedDrawUnits);
	const replaceableDrawUnitTriangleCount = sumDrawUnitTriangles(
		drawUnits,
		atlasReplacement.replaceableDrawUnitIds,
	);
	const indexedReplaceableDrawUnitTriangleCount = sumDrawUnitTriangles(
		drawUnits,
		indexedReplacement.replaceableDrawUnitIds,
	);
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
	if (stagedDrawUnits.length === 0) {
		metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount = retainedDrawUnitCount;
		submitRgbaTexturePageFamilyDrawUnits({
			gl,
			stateCache,
			program: rgbaTexturePageFamilyProgram,
			viewProjectionMatrix,
			resources: rgbaTexturePageFamilyResources,
			replaceableDrawUnitIds: atlasReplacement.replaceableDrawUnitIds,
			retainedDrawUnitCount,
			replaceableDrawUnitTriangleCount,
			route: rgbaTexturePageFamilySubmitRoute,
			metrics,
			planningNoVisibleRouteCount: atlasReplacement.noVisibleRouteCount,
			planningFallbackSamples: atlasReplacement.fallbackSamples,
		});
		submitIndexedPalettedFamilyDrawUnits({
			gl,
			stateCache,
			p8Program: indexedPalettedFamilyP8Program,
			p16Program: indexedPalettedFamilyP16Program,
			viewProjectionMatrix,
			resources: indexedPalettedFamilyResources,
			replaceableDrawUnitIds: indexedReplacement.replaceableDrawUnitIds,
			retainedDrawUnitCount,
			replaceableDrawUnitTriangleCount: indexedReplaceableDrawUnitTriangleCount,
			metrics,
			planningNoVisibleRouteCount: indexedReplacement.noVisibleRouteCount,
		});
		metrics.stateChangeCount += resetWorldSubmitExitRenderState({
			gl,
			stateCache,
		});
		return metrics;
	}

	const directSubmitContext = createWebgl2DirectSubmitContext({
		gl,
		stateCache,
		viewProjectionMatrix,
		program,
		texturedProgram,
		terrainBlendProgram,
		indexedP8Program,
		indexedP16Program,
	});
	submitWebgl2DirectDrawUnitPass({
		context: directSubmitContext,
		drawUnits: directPasses.opaque,
		terrainBackfaceCulling,
		metrics,
	});
	submitRgbaTexturePageFamilyDrawUnits({
		gl,
		stateCache,
		program: rgbaTexturePageFamilyProgram,
		viewProjectionMatrix,
		resources: rgbaTexturePageFamilyResources,
		replaceableDrawUnitIds: atlasReplacement.replaceableDrawUnitIds,
		retainedDrawUnitCount,
		replaceableDrawUnitTriangleCount,
		route: rgbaTexturePageFamilySubmitRoute,
		metrics,
		planningNoVisibleRouteCount: atlasReplacement.noVisibleRouteCount,
		planningFallbackSamples: atlasReplacement.fallbackSamples,
	});
	submitIndexedPalettedFamilyDrawUnits({
		gl,
		stateCache,
		p8Program: indexedPalettedFamilyP8Program,
		p16Program: indexedPalettedFamilyP16Program,
		viewProjectionMatrix,
		resources: indexedPalettedFamilyResources,
		replaceableDrawUnitIds: indexedReplacement.replaceableDrawUnitIds,
		retainedDrawUnitCount,
		replaceableDrawUnitTriangleCount: indexedReplaceableDrawUnitTriangleCount,
		metrics,
		planningNoVisibleRouteCount: indexedReplacement.noVisibleRouteCount,
	});
	submitWebgl2DirectDrawUnitPass({
		context: directSubmitContext,
		drawUnits: directPasses.blended,
		terrainBackfaceCulling,
		metrics,
	});
	metrics.stateChangeCount += resetWorldSubmitExitRenderState({
		gl,
		stateCache,
	});
	return metrics;
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
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
	uniformCache: ReturnType<typeof createDirectFamilyUniformCache>;
	previousProgramKind: Webgl2DirectProgramKind | null;
}

function createWebgl2DirectSubmitContext({
	gl,
	stateCache,
	viewProjectionMatrix,
	program,
	texturedProgram,
	terrainBlendProgram,
	indexedP8Program,
	indexedP16Program,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	viewProjectionMatrix: RenderMat4;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
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
		terrainBlend: terrainBlendProgram,
		indexedP8: indexedP8Program,
		indexedP16: indexedP16Program,
	};
	return {
		directContext,
		directPrograms,
		terrainBlendProgram,
		uniformCache,
		previousProgramKind: null,
	};
}

function submitWebgl2DirectDrawUnitPass({
	context,
	drawUnits,
	terrainBackfaceCulling,
	metrics,
}: {
	context: Webgl2DirectSubmitContext;
	drawUnits: readonly Webgl2WorldDrawUnit[];
	terrainBackfaceCulling: boolean;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
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
				terrainBlendProgram: context.terrainBlendProgram,
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
			enabled: terrainBackfaceCulling && route.programKind === "terrain",
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
		if (drawUnit.terrainBlend) {
			metrics.stateChangeCount += bindTerrainBlendTextures({
				stateCache: context.directContext.stateCache,
				terrainBlend: drawUnit.terrainBlend,
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

		const modelViewProjection = multiplyMat4(
			context.directContext.viewProjectionMatrix,
			drawUnit.modelMatrix,
		);
		if (
			!context.uniformCache.modelViewProjection ||
			!arraysEqual(context.uniformCache.modelViewProjection, modelViewProjection)
		) {
			context.directContext.gl.uniformMatrix4fv(
				route.activeProgram.uniforms.uModelViewProjection,
				false,
				modelViewProjection,
			);
			context.uniformCache.modelViewProjection = modelViewProjection;
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
		} else if (route.programKind !== "terrain") {
			uploadDirectColorUniforms({
				context: context.directContext,
				route,
				uniformCache: context.uniformCache,
				metrics,
			});
		}
		if (drawUnit.terrainBlend) {
			uploadTerrainBlendUniforms(
				context.directContext.gl,
				context.terrainBlendProgram,
				drawUnit.terrainBlend,
			);
			metrics.uniformUploadCount += TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT;
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

function submitIndexedPalettedFamilyDrawUnits({
	gl,
	stateCache,
	p8Program,
	p16Program,
	viewProjectionMatrix,
	resources,
	replaceableDrawUnitIds,
	retainedDrawUnitCount,
	replaceableDrawUnitTriangleCount,
	metrics,
	planningNoVisibleRouteCount,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	p8Program: Webgl2IndexedPalettedFamilyWorldProgram | undefined;
	p16Program: Webgl2IndexedPalettedFamilyWorldProgram | undefined;
	viewProjectionMatrix: RenderMat4;
	resources: Webgl2IndexedPalettedFamilySubmitResources;
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
	replaceableDrawUnitTriangleCount: number;
	metrics: Webgl2WorldSubmitMetrics;
	planningNoVisibleRouteCount: number;
}): void {
	if (replaceableDrawUnitIds.size === 0) {
		const emptyMetrics =
			createEmptyWebgl2IndexedPalettedFamilySubmitMetrics();
		metrics.indexedPalettedFamilyRetainedDirectDrawUnitCount =
			retainedDrawUnitCount;
		metrics.indexedPalettedFamilyNoVisibleRouteCount =
			planningNoVisibleRouteCount + emptyMetrics.noVisibleRouteCount;
		return;
	}
	if (!p8Program || !p16Program) {
		throw new Error(
			"Indexed-paletted family replacement was planned without compacted indexed shader programs.",
		);
	}
	const p8Resources = filterIndexedPalettedFamilyResourcesByFormat(
		resources,
		"p8",
	);
	const p16Resources = filterIndexedPalettedFamilyResourcesByFormat(
		resources,
		"index16",
	);
	const p8Metrics = submitWebgl2IndexedPalettedFamilyBatches({
		gl,
		stateCache,
		program: p8Program,
		viewProjectionMatrix,
		resources: p8Resources,
		replaceableDrawUnitIds,
		retainedDrawUnitCount,
	});
	const p16Metrics = submitWebgl2IndexedPalettedFamilyBatches({
		gl,
		stateCache,
		program: p16Program,
		viewProjectionMatrix,
		resources: p16Resources,
		replaceableDrawUnitIds,
		retainedDrawUnitCount,
	});
	metrics.drawCallCount +=
		p8Metrics.shaderDrawCallCount + p16Metrics.shaderDrawCallCount;
	metrics.triangleCount +=
		p8Metrics.submittedTriangleCount + p16Metrics.submittedTriangleCount;
	metrics.indexedPalettedFamilyShaderDrawCallCount =
		p8Metrics.shaderDrawCallCount + p16Metrics.shaderDrawCallCount;
	metrics.indexedPalettedFamilySubmittedBatchCount =
		p8Metrics.submittedBatchCount + p16Metrics.submittedBatchCount;
	metrics.indexedPalettedFamilySubmittedDrawSliceCount =
		p8Metrics.submittedDrawSliceCount + p16Metrics.submittedDrawSliceCount;
	metrics.indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount =
		p8Metrics.submittedSliceRepresentedDrawUnitCount +
		p16Metrics.submittedSliceRepresentedDrawUnitCount;
	metrics.indexedPalettedFamilySubmittedTriangleCount =
		p8Metrics.submittedTriangleCount + p16Metrics.submittedTriangleCount;
	metrics.indexedPalettedFamilyReplacedDrawUnitCount =
		replaceableDrawUnitIds.size;
	metrics.indexedPalettedFamilyReplacedDrawUnitTriangleCount =
		replaceableDrawUnitTriangleCount;
	metrics.indexedPalettedFamilyRetainedDirectDrawUnitCount =
		retainedDrawUnitCount;
	metrics.indexedPalettedFamilyNoVisibleRouteCount =
		planningNoVisibleRouteCount +
		p8Metrics.noVisibleRouteCount +
		p16Metrics.noVisibleRouteCount;
}

function filterIndexedPalettedFamilyResourcesByFormat(
	resources: Webgl2IndexedPalettedFamilySubmitResources,
	indexFormat: "p8" | "index16",
): Webgl2IndexedPalettedFamilySubmitResources {
	return {
		batches: resources.batches,
		indexedPalettedFamilies: resources.indexedPalettedFamilies
		.map((family) => ({
				...family,
				drawSlices: family.drawSlices.filter(
					(slice) => slice.indexFormat === indexFormat,
				),
			}))
			.filter((family) => family.drawSlices.length > 0),
		texturesByKey: resources.texturesByKey,
		detailTextures: resources.detailTextures,
	};
}

function submitRgbaTexturePageFamilyDrawUnits({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	resources,
	replaceableDrawUnitIds,
	retainedDrawUnitCount,
	replaceableDrawUnitTriangleCount,
	route,
	metrics,
	planningNoVisibleRouteCount,
	planningFallbackSamples,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2RgbaTexturePageFamilyWorldProgram | undefined;
	viewProjectionMatrix: RenderMat4;
	resources: Webgl2RgbaTexturePageFamilySubmitResources;
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
	replaceableDrawUnitTriangleCount: number;
	route: Webgl2RgbaTexturePageFamilySubmitRoute;
	metrics: Webgl2WorldSubmitMetrics;
	planningNoVisibleRouteCount: number;
	planningFallbackSamples: readonly string[];
}): void {
	if (
		program &&
		resources.batches.length > 0 &&
		resources.generation &&
		replaceableDrawUnitIds.size > 0
	) {
		const atlasMetrics = submitWebgl2RgbaTexturePageFamilyBatches({
			gl,
			stateCache,
			program,
			viewProjectionMatrix,
			resources: {
				batches: resources.batches,
				rgbaTexturePageFamilies: resources.rgbaTexturePageFamilies,
				generation: resources.generation,
			},
			replaceableDrawUnitIds,
			retainedDrawUnitCount,
		});
		metrics.drawCallCount += atlasMetrics.shaderDrawCallCount;
		metrics.triangleCount += atlasMetrics.submittedTriangleCount;
		metrics.rgbaTexturePageFamilyShaderDrawCallCount = atlasMetrics.shaderDrawCallCount;
		metrics.rgbaTexturePageFamilySubmittedBatchCount = atlasMetrics.submittedBatchCount;
		metrics.rgbaTexturePageFamilySubmittedDrawSliceCount = atlasMetrics.submittedDrawSliceCount;
		metrics.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount =
			atlasMetrics.submittedSliceRepresentedDrawUnitCount;
		metrics.rgbaTexturePageFamilySubmittedTriangleCount = atlasMetrics.submittedTriangleCount;
		metrics.rgbaTexturePageFamilyReplacedDrawUnitCount = atlasMetrics.replacedDrawUnitCount;
		metrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount =
			replaceableDrawUnitTriangleCount;
		applyRgbaTexturePageFamilyConservativeOverdraw(metrics);
		metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount =
			atlasMetrics.retainedDrawUnitCount;
		metrics.rgbaTexturePageFamilyNoVisibleRouteCount =
			planningNoVisibleRouteCount + atlasMetrics.noVisibleRouteCount;
		applyRgbaTexturePageFamilyNoVisibleRoute(
			metrics,
			route,
			planningNoVisibleRouteCount,
		);
		applyRgbaTexturePageFamilyNoVisibleRoute(
			metrics,
			route,
			atlasMetrics.noVisibleRouteCount,
		);
		metrics.rgbaTexturePageFamilyFallbackSamples = atlasMetrics.fallbackSamples;
		applyRgbaTexturePageFamilyDrawCallArithmetic(metrics);
		return;
	}
	const fallbackSamples = [...planningFallbackSamples];
	metrics.rgbaTexturePageFamilyNoVisibleRouteCount = planningNoVisibleRouteCount;
	applyRgbaTexturePageFamilyNoVisibleRoute(metrics, route, planningNoVisibleRouteCount);
	if (
		!program &&
		resources.batches.length > 0 &&
		resources.generation &&
		replaceableDrawUnitIds.size > 0
	) {
		fallbackSamples.push(
			"RGBA texture-page family submit missing shader program",
		);
	}
	const emptyAtlasMetrics =
		createEmptyWebgl2RgbaTexturePageFamilySubmitMetrics();
	metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount = retainedDrawUnitCount;
	metrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount = replaceableDrawUnitTriangleCount;
	applyRgbaTexturePageFamilyConservativeOverdraw(metrics);
	metrics.rgbaTexturePageFamilyNoVisibleRouteCount +=
		emptyAtlasMetrics.noVisibleRouteCount;
	applyRgbaTexturePageFamilyNoVisibleRoute(
		metrics,
		route,
		emptyAtlasMetrics.noVisibleRouteCount,
	);
	metrics.rgbaTexturePageFamilyFallbackSamples = [
		...fallbackSamples,
		...emptyAtlasMetrics.fallbackSamples,
	].slice(0, 8);
	applyRgbaTexturePageFamilyDrawCallArithmetic(metrics);
}

function sumDrawUnitTriangles(
	drawUnits: readonly Webgl2WorldDrawUnit[],
	drawUnitIds: ReadonlySet<string>,
): number {
	let triangleCount = 0;
	for (const drawUnit of drawUnits) {
		if (drawUnitIds.has(drawUnit.id)) {
			triangleCount += drawUnit.triangleCount;
		}
	}
	return triangleCount;
}

function applyRgbaTexturePageFamilyDrawCallArithmetic(
	metrics: Webgl2WorldSubmitMetrics,
): void {
	metrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount =
		metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount +
		metrics.rgbaTexturePageFamilyReplacedDrawUnitCount;
	metrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount =
		metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount + metrics.rgbaTexturePageFamilyShaderDrawCallCount;
	metrics.rgbaTexturePageFamilyDrawCallSavingsCount =
		metrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount -
		metrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount;
}

function applyRgbaTexturePageFamilyConservativeOverdraw(
	metrics: Webgl2WorldSubmitMetrics,
): void {
	metrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount = Math.max(
		0,
		metrics.rgbaTexturePageFamilySubmittedTriangleCount -
			metrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount,
	);
	metrics.rgbaTexturePageFamilyConservativeOverdrawRatio =
		metrics.rgbaTexturePageFamilySubmittedTriangleCount === 0
			? 0
			: metrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount /
				metrics.rgbaTexturePageFamilySubmittedTriangleCount;
}

function applyRgbaTexturePageFamilyNoVisibleRoute(
	metrics: Webgl2WorldSubmitMetrics,
	route: Webgl2RgbaTexturePageFamilySubmitRoute,
	count: number,
): void {
	if (count <= 0) {
		return;
	}
	switch (route) {
		case "scene-domain-exterior":
			metrics.rgbaTexturePageFamilyNoVisibleExteriorRouteCount += count;
			return;
		case "scene-domain-interior":
			metrics.rgbaTexturePageFamilyNoVisibleInteriorRouteCount += count;
			return;
		case "flat-world":
			metrics.rgbaTexturePageFamilyNoVisibleOtherRouteCount += count;
			return;
	}
}

const TERRAIN_BLEND_SAMPLER_UNIFORM_COUNT = 10;
const TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT = 13;
const INDEXED_DYNAMIC_UNIFORM_COUNT = 6;
const DETAIL_DYNAMIC_UNIFORM_COUNT = 2;
const DIRECT_TEXTURE_PAGE_DYNAMIC_UNIFORM_COUNT = 4;

function bindTerrainBlendTextures({
	stateCache,
	terrainBlend,
}: {
	stateCache: Webgl2StateCache;
	terrainBlend: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>;
}): number {
	let changeCount = 0;
	const base = terrainBlend.base.texture.texture;
	const overlay0 = terrainBlend.overlays[0];
	const overlay1 = terrainBlend.overlays[1];
	const overlay2 = terrainBlend.overlays[2];
	const road0 = terrainBlend.roads[0];
	const road1 = terrainBlend.roads[1];
	const bindings = [
		terrainBlend.base.texture.texture,
		overlay0?.terrain.texture.texture ?? base,
		overlay1?.terrain.texture.texture ?? base,
		overlay2?.terrain.texture.texture ?? base,
		overlay0?.alpha.texture.texture ?? base,
		overlay1?.alpha.texture.texture ?? base,
		overlay2?.alpha.texture.texture ?? base,
		road0?.road.texture.texture ?? base,
		road0?.alpha.texture.texture ?? base,
		road1?.alpha.texture.texture ?? base,
	];
	for (const [unit, texture] of bindings.entries()) {
		if (stateCache.bindTexture2D(unit, texture)) {
			changeCount += 1;
		}
	}
	return changeCount;
}

function uploadTerrainBlendUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TerrainBlendWorldProgram,
	terrainBlend: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>,
): void {
	const overlay0 = terrainBlend.overlays[0];
	const overlay1 = terrainBlend.overlays[1];
	const overlay2 = terrainBlend.overlays[2];
	const road0 = terrainBlend.roads[0];
	const road1 = terrainBlend.roads[1];
	gl.uniform1f(program.uniforms.uBaseTiling, terrainBlend.base.tiling);
	gl.uniform1f(program.uniforms.uOverlayTiling0, overlay0?.terrain.tiling ?? 1);
	gl.uniform1f(program.uniforms.uOverlayTiling1, overlay1?.terrain.tiling ?? 1);
	gl.uniform1f(program.uniforms.uOverlayTiling2, overlay2?.terrain.tiling ?? 1);
	gl.uniform1i(program.uniforms.uOverlayRotation0, overlay0?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayRotation1, overlay1?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayRotation2, overlay2?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayCount, terrainBlend.overlays.length);
	gl.uniform1f(program.uniforms.uRoadTiling, road0?.road.tiling ?? 1);
	gl.uniform1i(program.uniforms.uRoadRotation0, road0?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uRoadRotation1, road1?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uRoadCount, terrainBlend.roads.length);
}

export function planWebgl2FlatWorldSubmitOrder(
	frame: StagedWorldFrame,
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): Webgl2WorldDrawUnit[] {
	const visibleDrawUnits: Webgl2WorldDrawUnit[] = [];
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			const drawUnit = drawUnitsById.get(draw.drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`Staged world frame referenced missing WebGL2 draw unit ${draw.drawUnitId}.`,
				);
			}
			if (drawUnit.kind !== "portal-mask") {
				visibleDrawUnits.push(drawUnit);
			}
		}
	}
	return visibleDrawUnits.sort(compareWebgl2FlatWorldDrawUnits);
}

export function planWebgl2PortalMaskSubmitOrder(
	frame: StagedWorldFrame,
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): Webgl2WorldDrawUnit[] {
	const maskDrawUnits: Webgl2WorldDrawUnit[] = [];
	for (const pass of frame.passes) {
		for (const draw of pass.draws) {
			const drawUnit = drawUnitsById.get(draw.drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`Staged world frame referenced missing WebGL2 draw unit ${draw.drawUnitId}.`,
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

function compareWebgl2FlatWorldDrawUnits(
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
