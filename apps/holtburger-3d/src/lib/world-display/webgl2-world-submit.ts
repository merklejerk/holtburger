import { multiplyMat4, type RenderMat4 } from "./render-math";
import type { StagedWorldFrame } from "./staged-world-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
import {
	createEmptyWebgl2BakedGeometrySubmitMetrics,
	planWebgl2BakedGeometryReplacement,
	submitWebgl2BakedGeometryBatch,
	type Webgl2BakedGeometrySubmitResources,
	type Webgl2BakedGeometryWorldProgram,
} from "./webgl2-baked-submit";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";
import type { TexturePageBinding } from "./texture-page-binding";

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
	drawCallCount: number;
	programSwitchCount: number;
	vertexArrayBindCount: number;
	uniformUploadCount: number;
	stateChangeCount: number;
	triangleCount: number;
	visibleDrawUnitCountsByMaterialKind: Readonly<Record<string, number>>;
	visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily: Readonly<
		Record<string, number>
	>;
	bakedShaderDrawCallCount: number;
	bakedSubmittedBatchCount: number;
	bakedSubmittedDrawSliceCount: number;
	bakedSubmittedSliceRepresentedDrawUnitCount: number;
	bakedSubmittedTriangleCount: number;
	bakedReplacedDrawUnitCount: number;
	bakedReplacedDrawUnitTriangleCount: number;
	bakedConservativeOverdrawTriangleCount: number;
	bakedConservativeOverdrawRatio: number;
	bakedRetainedDirectDrawUnitCount: number;
	bakedOriginalDrawCallEstimateCount: number;
	bakedSubmittedDrawCallEstimateCount: number;
	bakedDrawCallSavingsCount: number;
	bakedSubmitNoVisibleRouteCount: number;
	bakedSubmitNoVisibleExteriorRouteCount: number;
	bakedSubmitNoVisibleInteriorRouteCount: number;
	bakedSubmitNoVisibleOtherRouteCount: number;
	bakedSubmitFallbackSamples: readonly string[];
	directTexturePageDrawCount: number;
	directSingleEntryTexturePageDrawCount: number;
	directPackedTexturePageDrawCount: number;
	directPackedTexturePageEstimatedBindAvoidedCount: number;
	directPackedTexturePageTextureCount: number;
	directTexturePageFallbackSamples: readonly string[];
	stagedAtlasDrawCount: number;
	stagedAtlasStandaloneDirectDrawCount: number;
	stagedAtlasEstimatedTextureBindAvoidedCount: number;
	stagedAtlasSharedTextureAtlasTextureCount: number;
	stagedAtlasFallbackSamples: readonly string[];
}

const EMPTY_SUBMIT_METRICS: Webgl2WorldSubmitMetrics = {
	visibleDrawUnitCount: 0,
	portalMaskDrawUnitCount: 0,
	exteriorDomainDrawUnitCount: 0,
	interiorDomainDrawUnitCount: 0,
	drawCallCount: 0,
	programSwitchCount: 0,
	vertexArrayBindCount: 0,
	uniformUploadCount: 0,
	stateChangeCount: 0,
	triangleCount: 0,
	visibleDrawUnitCountsByMaterialKind: {},
	visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily: {},
	bakedShaderDrawCallCount: 0,
	bakedSubmittedBatchCount: 0,
	bakedSubmittedDrawSliceCount: 0,
	bakedSubmittedSliceRepresentedDrawUnitCount: 0,
	bakedSubmittedTriangleCount: 0,
	bakedReplacedDrawUnitCount: 0,
	bakedReplacedDrawUnitTriangleCount: 0,
	bakedConservativeOverdrawTriangleCount: 0,
	bakedConservativeOverdrawRatio: 0,
	bakedRetainedDirectDrawUnitCount: 0,
	bakedOriginalDrawCallEstimateCount: 0,
	bakedSubmittedDrawCallEstimateCount: 0,
	bakedDrawCallSavingsCount: 0,
	bakedSubmitNoVisibleRouteCount: 0,
	bakedSubmitNoVisibleExteriorRouteCount: 0,
	bakedSubmitNoVisibleInteriorRouteCount: 0,
	bakedSubmitNoVisibleOtherRouteCount: 0,
	bakedSubmitFallbackSamples: [],
	directTexturePageDrawCount: 0,
	directSingleEntryTexturePageDrawCount: 0,
	directPackedTexturePageDrawCount: 0,
	directPackedTexturePageEstimatedBindAvoidedCount: 0,
	directPackedTexturePageTextureCount: 0,
	directTexturePageFallbackSamples: [],
	stagedAtlasDrawCount: 0,
	stagedAtlasStandaloneDirectDrawCount: 0,
	stagedAtlasEstimatedTextureBindAvoidedCount: 0,
	stagedAtlasSharedTextureAtlasTextureCount: 0,
	stagedAtlasFallbackSamples: [],
};

export type Webgl2BakedSubmitRoute =
	| "flat-world"
	| "scene-domain-exterior"
	| "scene-domain-interior";

export function createEmptyWebgl2WorldSubmitMetrics(): Webgl2WorldSubmitMetrics {
	return {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCountsByMaterialKind: {},
		bakedSubmitFallbackSamples: [],
		directTexturePageFallbackSamples: [],
		stagedAtlasFallbackSamples: [],
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
	bakedGeometryProgram,
	bakedGeometryResources = { batches: [], generation: null },
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
	bakedGeometryProgram?: Webgl2BakedGeometryWorldProgram;
	bakedGeometryResources?: Webgl2BakedGeometrySubmitResources;
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
		bakedGeometryProgram,
		bakedGeometryResources,
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
	bakedGeometryProgram,
	bakedGeometryResources = { batches: [], generation: null },
	viewProjectionMatrix,
	drawUnits,
	portalMaskDrawUnitCount = 0,
	exteriorDomainDrawUnitCount = 0,
	interiorDomainDrawUnitCount = 0,
	bakedSubmitRoute = "flat-world",
	terrainBackfaceCulling = false,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
	indexedP8Program: Webgl2IndexedP8WorldProgram;
	indexedP16Program: Webgl2IndexedP16WorldProgram;
	bakedGeometryProgram?: Webgl2BakedGeometryWorldProgram;
	bakedGeometryResources?: Webgl2BakedGeometrySubmitResources;
	viewProjectionMatrix: RenderMat4;
	drawUnits: readonly Webgl2WorldDrawUnit[];
	portalMaskDrawUnitCount?: number;
	exteriorDomainDrawUnitCount?: number;
	interiorDomainDrawUnitCount?: number;
	bakedSubmitRoute?: Webgl2BakedSubmitRoute;
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
		visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily: {},
		directPackedTexturePageTextureCount:
			bakedGeometryResources.generation?.textures.length ?? 0,
		stagedAtlasSharedTextureAtlasTextureCount:
			bakedGeometryResources.generation?.textures.length ?? 0,
	};
	if (drawUnits.length === 0) {
		return metrics;
	}
	const atlasReplacement = planWebgl2BakedGeometryReplacement({
		visibleDrawUnitIds: drawUnits.map((drawUnit) => drawUnit.id),
		resources: bakedGeometryResources,
	});
	const stagedDrawUnits =
		atlasReplacement.replaceableDrawUnitIds.size === 0
			? drawUnits
			: drawUnits.filter(
					(drawUnit) =>
						!atlasReplacement.replaceableDrawUnitIds.has(drawUnit.id),
				);
	const retainedDrawUnitCount = stagedDrawUnits.length;
	metrics.visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily =
		countDrawUnitsByBakeMaterialFamily(stagedDrawUnits);
	const replaceableDrawUnitTriangleCount = sumDrawUnitTriangles(
		drawUnits,
		atlasReplacement.replaceableDrawUnitIds,
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
		metrics.bakedRetainedDirectDrawUnitCount = retainedDrawUnitCount;
		submitBakedGeometryDrawUnits({
			gl,
			stateCache,
			program: bakedGeometryProgram,
			viewProjectionMatrix,
			resources: bakedGeometryResources,
			replaceableDrawUnitIds: atlasReplacement.replaceableDrawUnitIds,
			retainedDrawUnitCount,
			replaceableDrawUnitTriangleCount,
			route: bakedSubmitRoute,
			metrics,
			planningNoVisibleRouteCount: atlasReplacement.noVisibleRouteCount,
			planningFallbackSamples: atlasReplacement.fallbackSamples,
		});
		return metrics;
	}

	let previousModelViewProjection: RenderMat4 | null = null;
	let previousColor: Float32Array | null = null;
	let previousAlphaTest: number | null = null;
	let previousProgramKind = "";
	for (const drawUnit of stagedDrawUnits) {
		const texture = drawUnit.texture;
		const useTerrainBlend = drawUnit.terrainBlend !== null;
		const useIndexed = drawUnit.indexedMaterial !== null;
		const useTexture = texture !== null && !useTerrainBlend;
		const activeIndexedProgram =
			drawUnit.indexedMaterial?.indexFormat === "p8"
				? indexedP8Program
				: drawUnit.indexedMaterial?.indexFormat === "index16"
					? indexedP16Program
					: null;
		const activeProgram = useTerrainBlend
			? terrainBlendProgram
			: activeIndexedProgram
				? activeIndexedProgram
				: useTexture
					? texturedProgram
					: program;
		const programKind = useTerrainBlend
			? "terrain"
			: useIndexed
				? (drawUnit.indexedMaterial?.indexFormat ?? "indexed")
				: useTexture
					? "texture"
					: "flat";
		if (stateCache.useProgram(activeProgram.program)) {
			metrics.programSwitchCount += 1;
			metrics.stateChangeCount += 1;
			previousModelViewProjection = null;
			previousColor = null;
			previousAlphaTest = null;
			previousProgramKind = programKind;
			if (useTexture) {
				gl.uniform1i(texturedProgram.uniforms.uTexture, 0);
				gl.uniform1i(texturedProgram.uniforms.uDetailTexture, 1);
				metrics.uniformUploadCount += 2;
			}
			if (useIndexed) {
				if (!activeIndexedProgram) {
					throw new Error(
						`Indexed draw unit ${drawUnit.id} has no indexed program.`,
					);
				}
				uploadIndexedSamplerUniforms(gl, activeIndexedProgram);
				metrics.uniformUploadCount += 3;
			}
			if (useTerrainBlend) {
				uploadTerrainBlendSamplerUniforms(gl, terrainBlendProgram);
				metrics.uniformUploadCount += TERRAIN_BLEND_SAMPLER_UNIFORM_COUNT;
			}
		} else if (previousProgramKind !== programKind) {
			previousModelViewProjection = null;
			previousColor = null;
			previousAlphaTest = null;
			previousProgramKind = programKind;
		}
		metrics.stateChangeCount += applyDrawUnitRenderState({
			gl,
			stateCache,
			drawUnit,
		});
		metrics.stateChangeCount += stateCache.setCullState({
			enabled: terrainBackfaceCulling && useTerrainBlend,
			mode: gl.BACK,
		});
		const texturePageResolution =
			useTexture && texture
				? resolveDrawUnitBaseTexturePageBinding(drawUnit)
				: null;
		const texturePageBinding = texturePageResolution;
		metrics.directTexturePageFallbackSamples = appendSubmitFallbackSamples(
			metrics.directTexturePageFallbackSamples,
			drawUnit.texturePageBindingFallbackSamples,
		);
		metrics.stagedAtlasFallbackSamples =
			metrics.directTexturePageFallbackSamples;
		if (useTexture) {
			if (texturePageBinding) {
				metrics.directTexturePageDrawCount += 1;
				if (texturePageBinding.pageKind === "packed-atlas") {
					metrics.directPackedTexturePageDrawCount += 1;
					metrics.directPackedTexturePageEstimatedBindAvoidedCount += 1;
				} else {
					metrics.directSingleEntryTexturePageDrawCount += 1;
				}
				metrics.stagedAtlasDrawCount = metrics.directPackedTexturePageDrawCount;
				metrics.stagedAtlasEstimatedTextureBindAvoidedCount =
					metrics.directPackedTexturePageEstimatedBindAvoidedCount;
				metrics.stagedAtlasStandaloneDirectDrawCount =
					metrics.directSingleEntryTexturePageDrawCount;
			} else {
				metrics.stagedAtlasStandaloneDirectDrawCount += 1;
			}
		}
		const activeTexture =
			texturePageBinding?.texture.texture ?? texture?.texture ?? null;
		if (activeTexture && stateCache.bindTexture2D(0, activeTexture)) {
			metrics.stateChangeCount += 1;
		}
		if (drawUnit.detailOverlay) {
			const unit = drawUnit.indexedMaterial ? 2 : 1;
			if (
				stateCache.bindTexture2D(unit, drawUnit.detailOverlay.texture.texture)
			) {
				metrics.stateChangeCount += 1;
			}
		}
		if (drawUnit.terrainBlend) {
			metrics.stateChangeCount += bindTerrainBlendTextures({
				stateCache,
				terrainBlend: drawUnit.terrainBlend,
			});
		}
		if (drawUnit.indexedMaterial) {
			metrics.stateChangeCount += bindIndexedMaterialTextures({
				stateCache,
				indexedMaterial: drawUnit.indexedMaterial,
			});
		}
		if (stateCache.bindVertexArray(drawUnit.vertexArray.vertexArray)) {
			metrics.vertexArrayBindCount += 1;
			metrics.stateChangeCount += 1;
		}

		const modelViewProjection = multiplyMat4(
			viewProjectionMatrix,
			drawUnit.modelMatrix,
		);
		if (
			!previousModelViewProjection ||
			!arraysEqual(previousModelViewProjection, modelViewProjection)
		) {
			gl.uniformMatrix4fv(
				activeProgram.uniforms.uModelViewProjection,
				false,
				modelViewProjection,
			);
			previousModelViewProjection = modelViewProjection;
			metrics.uniformUploadCount += 1;
		}
		if (
			!useTerrainBlend &&
			(!previousColor || !arraysEqual(previousColor, drawUnit.color))
		) {
			const colorProgram =
				activeIndexedProgram ?? (useTexture ? texturedProgram : program);
			gl.uniform4fv(colorProgram.uniforms.uColor, drawUnit.color);
			previousColor = drawUnit.color;
			metrics.uniformUploadCount += 1;
		}
		if (useTexture || useIndexed) {
			const alphaTest = drawUnit.materialBehavior?.alphaTest ?? 0;
			if (previousAlphaTest !== alphaTest) {
				const alphaProgram = activeIndexedProgram ?? texturedProgram;
				gl.uniform1f(alphaProgram.uniforms.uAlphaTest, alphaTest);
				previousAlphaTest = alphaTest;
				metrics.uniformUploadCount += 1;
			}
		}
		if (drawUnit.indexedMaterial) {
			if (!activeIndexedProgram) {
				throw new Error(
					`Indexed draw unit ${drawUnit.id} has no indexed program.`,
				);
			}
			uploadIndexedMaterialUniforms(
				gl,
				activeIndexedProgram,
				drawUnit.indexedMaterial,
			);
			metrics.uniformUploadCount += INDEXED_DYNAMIC_UNIFORM_COUNT;
		}
		if (useTexture || useIndexed) {
			const detailProgram = activeIndexedProgram ?? texturedProgram;
			uploadDetailOverlayUniforms(gl, detailProgram, drawUnit.detailOverlay);
			metrics.uniformUploadCount += DETAIL_DYNAMIC_UNIFORM_COUNT;
		}
		if (useTexture) {
			uploadDirectTexturePageUniforms(gl, texturedProgram, texturePageBinding);
			metrics.uniformUploadCount += DIRECT_TEXTURE_PAGE_DYNAMIC_UNIFORM_COUNT;
		}
		if (drawUnit.terrainBlend) {
			uploadTerrainBlendUniforms(
				gl,
				terrainBlendProgram,
				drawUnit.terrainBlend,
			);
			metrics.uniformUploadCount += TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT;
		}

		gl.drawElements(gl.TRIANGLES, drawUnit.vertexCount, drawUnit.indexType, 0);
		metrics.drawCallCount += 1;
		metrics.triangleCount += drawUnit.triangleCount;
	}
	submitBakedGeometryDrawUnits({
		gl,
		stateCache,
		program: bakedGeometryProgram,
		viewProjectionMatrix,
		resources: bakedGeometryResources,
		replaceableDrawUnitIds: atlasReplacement.replaceableDrawUnitIds,
		retainedDrawUnitCount,
		replaceableDrawUnitTriangleCount,
		route: bakedSubmitRoute,
		metrics,
		planningNoVisibleRouteCount: atlasReplacement.noVisibleRouteCount,
		planningFallbackSamples: atlasReplacement.fallbackSamples,
	});
	return metrics;
}

function submitBakedGeometryDrawUnits({
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
	program: Webgl2BakedGeometryWorldProgram | undefined;
	viewProjectionMatrix: RenderMat4;
	resources: Webgl2BakedGeometrySubmitResources;
	replaceableDrawUnitIds: ReadonlySet<string>;
	retainedDrawUnitCount: number;
	replaceableDrawUnitTriangleCount: number;
	route: Webgl2BakedSubmitRoute;
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
		const atlasMetrics = submitWebgl2BakedGeometryBatch({
			gl,
			stateCache,
			program,
			viewProjectionMatrix,
			resources: {
				batches: resources.batches,
				generation: resources.generation,
			},
			replaceableDrawUnitIds,
			retainedDrawUnitCount,
		});
		metrics.drawCallCount += atlasMetrics.shaderDrawCallCount;
		metrics.triangleCount += atlasMetrics.submittedTriangleCount;
		metrics.bakedShaderDrawCallCount = atlasMetrics.shaderDrawCallCount;
		metrics.bakedSubmittedBatchCount = atlasMetrics.submittedBatchCount;
		metrics.bakedSubmittedDrawSliceCount = atlasMetrics.submittedDrawSliceCount;
		metrics.bakedSubmittedSliceRepresentedDrawUnitCount =
			atlasMetrics.submittedSliceRepresentedDrawUnitCount;
		metrics.bakedSubmittedTriangleCount = atlasMetrics.submittedTriangleCount;
		metrics.bakedReplacedDrawUnitCount = atlasMetrics.replacedDrawUnitCount;
		metrics.bakedReplacedDrawUnitTriangleCount =
			replaceableDrawUnitTriangleCount;
		applyBakedGeometryConservativeOverdraw(metrics);
		metrics.bakedRetainedDirectDrawUnitCount =
			atlasMetrics.retainedDrawUnitCount;
		metrics.bakedSubmitNoVisibleRouteCount =
			planningNoVisibleRouteCount + atlasMetrics.noVisibleRouteCount;
		applyBakedGeometryNoVisibleRoute(
			metrics,
			route,
			planningNoVisibleRouteCount,
		);
		applyBakedGeometryNoVisibleRoute(
			metrics,
			route,
			atlasMetrics.noVisibleRouteCount,
		);
		metrics.bakedSubmitFallbackSamples = atlasMetrics.fallbackSamples;
		applyBakedGeometryDrawCallArithmetic(metrics);
		return;
	}
	const fallbackSamples = [...planningFallbackSamples];
	metrics.bakedSubmitNoVisibleRouteCount = planningNoVisibleRouteCount;
	applyBakedGeometryNoVisibleRoute(
		metrics,
		route,
		planningNoVisibleRouteCount,
	);
	if (
		!program &&
		resources.batches.length > 0 &&
		resources.generation &&
		replaceableDrawUnitIds.size > 0
	) {
		fallbackSamples.push("baked submit missing shader program");
	}
	const emptyAtlasMetrics =
		createEmptyWebgl2BakedGeometrySubmitMetrics();
	metrics.bakedRetainedDirectDrawUnitCount = retainedDrawUnitCount;
	metrics.bakedReplacedDrawUnitTriangleCount = replaceableDrawUnitTriangleCount;
	applyBakedGeometryConservativeOverdraw(metrics);
	metrics.bakedSubmitNoVisibleRouteCount +=
		emptyAtlasMetrics.noVisibleRouteCount;
	applyBakedGeometryNoVisibleRoute(
		metrics,
		route,
		emptyAtlasMetrics.noVisibleRouteCount,
	);
	metrics.bakedSubmitFallbackSamples = [
		...fallbackSamples,
		...emptyAtlasMetrics.fallbackSamples,
	].slice(0, 8);
	applyBakedGeometryDrawCallArithmetic(metrics);
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

function applyBakedGeometryDrawCallArithmetic(
	metrics: Webgl2WorldSubmitMetrics,
): void {
	metrics.bakedOriginalDrawCallEstimateCount =
		metrics.bakedRetainedDirectDrawUnitCount +
		metrics.bakedReplacedDrawUnitCount;
	metrics.bakedSubmittedDrawCallEstimateCount =
		metrics.bakedRetainedDirectDrawUnitCount + metrics.bakedShaderDrawCallCount;
	metrics.bakedDrawCallSavingsCount =
		metrics.bakedOriginalDrawCallEstimateCount -
		metrics.bakedSubmittedDrawCallEstimateCount;
}

function applyBakedGeometryConservativeOverdraw(
	metrics: Webgl2WorldSubmitMetrics,
): void {
	metrics.bakedConservativeOverdrawTriangleCount = Math.max(
		0,
		metrics.bakedSubmittedTriangleCount -
			metrics.bakedReplacedDrawUnitTriangleCount,
	);
	metrics.bakedConservativeOverdrawRatio =
		metrics.bakedSubmittedTriangleCount === 0
			? 0
			: metrics.bakedConservativeOverdrawTriangleCount /
				metrics.bakedSubmittedTriangleCount;
}

function applyBakedGeometryNoVisibleRoute(
	metrics: Webgl2WorldSubmitMetrics,
	route: Webgl2BakedSubmitRoute,
	count: number,
): void {
	if (count <= 0) {
		return;
	}
	switch (route) {
		case "scene-domain-exterior":
			metrics.bakedSubmitNoVisibleExteriorRouteCount += count;
			return;
		case "scene-domain-interior":
			metrics.bakedSubmitNoVisibleInteriorRouteCount += count;
			return;
		case "flat-world":
			metrics.bakedSubmitNoVisibleOtherRouteCount += count;
			return;
	}
}

const TERRAIN_BLEND_SAMPLER_UNIFORM_COUNT = 10;
const TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT = 13;
const INDEXED_DYNAMIC_UNIFORM_COUNT = 6;
const DETAIL_DYNAMIC_UNIFORM_COUNT = 2;
const DIRECT_TEXTURE_PAGE_DYNAMIC_UNIFORM_COUNT = 4;

function uploadTerrainBlendSamplerUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TerrainBlendWorldProgram,
): void {
	gl.uniform1i(program.uniforms.uBaseTexture, 0);
	gl.uniform1i(program.uniforms.uOverlay0, 1);
	gl.uniform1i(program.uniforms.uOverlay1, 2);
	gl.uniform1i(program.uniforms.uOverlay2, 3);
	gl.uniform1i(program.uniforms.uOverlayAlpha0, 4);
	gl.uniform1i(program.uniforms.uOverlayAlpha1, 5);
	gl.uniform1i(program.uniforms.uOverlayAlpha2, 6);
	gl.uniform1i(program.uniforms.uRoadTexture, 7);
	gl.uniform1i(program.uniforms.uRoadAlpha0, 8);
	gl.uniform1i(program.uniforms.uRoadAlpha1, 9);
}

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

function uploadIndexedSamplerUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram,
): void {
	gl.uniform1i(program.uniforms.uIndexTexture, 0);
	gl.uniform1i(program.uniforms.uPaletteTexture, 1);
	gl.uniform1i(program.uniforms.uDetailTexture, 2);
}

function bindIndexedMaterialTextures({
	stateCache,
	indexedMaterial,
}: {
	stateCache: Webgl2StateCache;
	indexedMaterial: NonNullable<Webgl2WorldDrawUnit["indexedMaterial"]>;
}): number {
	let changeCount = 0;
	if (stateCache.bindTexture2D(0, indexedMaterial.indexTexture.texture)) {
		changeCount += 1;
	}
	if (stateCache.bindTexture2D(1, indexedMaterial.paletteTexture.texture)) {
		changeCount += 1;
	}
	return changeCount;
}

function resolveDrawUnitBaseTexturePageBinding(
	drawUnit: Webgl2WorldDrawUnit,
): TexturePageBinding | null {
	return (
		drawUnit.texturePageBindings.find(
			(binding) => binding.usageBucket === "base-color",
		) ?? null
	);
}

function appendSubmitFallbackSamples(
	current: readonly string[],
	next: readonly string[],
): readonly string[] {
	if (next.length === 0) {
		return current;
	}
	return [...current, ...next].slice(0, 8);
}

function uploadIndexedMaterialUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram,
	indexedMaterial: NonNullable<Webgl2WorldDrawUnit["indexedMaterial"]>,
): void {
	gl.uniform2f(
		program.uniforms.uTextureSize,
		indexedMaterial.width,
		indexedMaterial.height,
	);
	gl.uniform1f(
		program.uniforms.uPaletteColorCount,
		indexedMaterial.paletteColorCount,
	);
	gl.uniform1i(program.uniforms.uClipThreshold, indexedMaterial.clipThreshold);
	gl.uniform1i(
		program.uniforms.uRepeatS,
		indexedMaterial.wrapS === "repeat" ? 1 : 0,
	);
	gl.uniform1i(
		program.uniforms.uRepeatT,
		indexedMaterial.wrapT === "repeat" ? 1 : 0,
	);
}

function uploadDetailOverlayUniforms(
	gl: WebGL2RenderingContext,
	program:
		| Webgl2TexturedWorldProgram
		| Webgl2IndexedP8WorldProgram
		| Webgl2IndexedP16WorldProgram,
	detailOverlay: Webgl2WorldDrawUnit["detailOverlay"],
): void {
	gl.uniform1f(program.uniforms.uDetailTiling, detailOverlay?.tiling ?? 1);
	gl.uniform1i(program.uniforms.uDetailEnabled, detailOverlay ? 1 : 0);
}

function uploadDirectTexturePageUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TexturedWorldProgram,
	binding: TexturePageBinding | null,
): void {
	if (!binding) {
		gl.uniform1i(program.uniforms.uAtlasEnabled, 0);
		gl.uniform4f(program.uniforms.uAtlasRect, 0, 0, 1, 1);
		gl.uniform2f(program.uniforms.uAtlasSize, 1, 1);
		gl.uniform2f(program.uniforms.uTexturePageWrapMode, 0, 0);
		return;
	}
	gl.uniform1i(program.uniforms.uAtlasEnabled, 1);
	gl.uniform4f(
		program.uniforms.uAtlasRect,
		binding.rect[0],
		binding.rect[1],
		binding.rect[2],
		binding.rect[3],
	);
	gl.uniform2f(program.uniforms.uAtlasSize, binding.width, binding.height);
	gl.uniform2f(
		program.uniforms.uTexturePageWrapMode,
		binding.wrapS === "repeat" ? 1 : 0,
		binding.wrapT === "repeat" ? 1 : 0,
	);
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

function countDrawUnitsByBakeMaterialFamily(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const drawUnit of drawUnits) {
		const family = drawUnit.bakeEligibility.material.family;
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
