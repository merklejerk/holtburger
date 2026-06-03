import type { RenderMat4 } from "../../render-math";
import {
	mapWebgl2DrawUnitToDirectRenderFamilySubmission,
	type DirectRenderFamilySubmission,
} from "./direct-render-family";
import type { Webgl2StateCache } from "../../webgl2-state-cache";
import type {
	TexturePageDescriptor,
	TexturePageResourceBinding,
} from "../../texture-pages/texture-page-binding";
import type { Webgl2WorldDrawUnit } from "../../webgl2-world-resources";
import type {
	Webgl2FlatWorldProgram,
	Webgl2IndexedP16WorldProgram,
	Webgl2IndexedP8WorldProgram,
	Webgl2TexturedWorldProgram,
	Webgl2WorldSubmitMetrics,
} from "../../webgl2-world-submit";

type Webgl2DirectWorldProgram =
	| Webgl2FlatWorldProgram
	| Webgl2TexturedWorldProgram
	| Webgl2IndexedP8WorldProgram
	| Webgl2IndexedP16WorldProgram;

type Webgl2DirectColorWorldProgram =
	| Webgl2FlatWorldProgram
	| Webgl2TexturedWorldProgram
	| Webgl2IndexedP8WorldProgram
	| Webgl2IndexedP16WorldProgram;

type Webgl2DirectAlphaWorldProgram =
	| Webgl2TexturedWorldProgram
	| Webgl2IndexedP8WorldProgram
	| Webgl2IndexedP16WorldProgram;

export type Webgl2DirectProgramKind =
	| "flat"
	| "texture"
	| "indexed-p8"
	| "indexed-p16";

export interface DirectFamilyDrawTextureUnits {
	rgbaTexture: 0;
	rgbaDetail: 1;
	indexedTexels: 0;
	indexedPalette: 1;
	indexedDetail: 2;
}

export interface DirectFamilyDrawContext {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	viewProjectionMatrix: RenderMat4;
	textureUnits: DirectFamilyDrawTextureUnits;
}

export interface DirectFamilyUniformCache {
	modelViewProjection: RenderMat4;
	modelViewProjectionValid: boolean;
	color: Float32Array | null;
	alphaTest: number | null;
}

export interface Webgl2DirectDrawPrograms {
	flat: Webgl2FlatWorldProgram;
	rgbaTexturePage: Webgl2TexturedWorldProgram;
	indexedP8: Webgl2IndexedP8WorldProgram;
	indexedP16: Webgl2IndexedP16WorldProgram;
}

interface Webgl2DirectDrawRouteBase {
	drawUnit: Webgl2WorldDrawUnit;
	submission: DirectRenderFamilySubmission;
	programKind: Webgl2DirectProgramKind;
	activeProgram: Webgl2DirectWorldProgram;
	colorProgram: Webgl2DirectColorWorldProgram | null;
	alphaProgram: Webgl2DirectAlphaWorldProgram | null;
	detailProgram: Webgl2DirectAlphaWorldProgram | null;
}

export interface Webgl2FlatDirectDrawRoute extends Webgl2DirectDrawRouteBase {
	programKind: "flat";
	activeProgram: Webgl2FlatWorldProgram;
	indexedProgram: null;
	colorProgram: Webgl2FlatWorldProgram;
	alphaProgram: null;
	detailProgram: null;
	texturePageBinding: TexturePageResourceBinding | null;
	activeBaseTexture: WebGLTexture | null;
	detailTextureUnit: number | null;
}

export interface Webgl2RgbaTexturePageDirectDrawRoute extends Webgl2DirectDrawRouteBase {
	programKind: "texture";
	activeProgram: Webgl2TexturedWorldProgram;
	indexedProgram: null;
	colorProgram: Webgl2TexturedWorldProgram;
	alphaProgram: Webgl2TexturedWorldProgram;
	detailProgram: Webgl2TexturedWorldProgram;
	texturePageBinding: TexturePageResourceBinding | null;
	activeBaseTexture: WebGLTexture | null;
	detailTextureUnit: typeof DIRECT_FAMILY_DRAW_TEXTURE_UNITS.rgbaDetail;
}

export interface Webgl2IndexedDirectDrawRoute extends Webgl2DirectDrawRouteBase {
	programKind: "indexed-p8" | "indexed-p16";
	activeProgram: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram;
	indexedProgram: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram;
	colorProgram: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram;
	alphaProgram: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram;
	detailProgram: Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram;
	texturePageBinding: null;
	activeBaseTexture: null;
	detailTextureUnit: typeof DIRECT_FAMILY_DRAW_TEXTURE_UNITS.indexedDetail;
}

export type Webgl2DirectDrawRoute =
	| Webgl2FlatDirectDrawRoute
	| Webgl2RgbaTexturePageDirectDrawRoute
	| Webgl2IndexedDirectDrawRoute;

export const DIRECT_FAMILY_DRAW_TEXTURE_UNITS: DirectFamilyDrawTextureUnits = {
	rgbaTexture: 0,
	rgbaDetail: 1,
	indexedTexels: 0,
	indexedPalette: 1,
	indexedDetail: 2,
};

const INDEXED_DYNAMIC_UNIFORM_COUNT = 6;
const DETAIL_DYNAMIC_UNIFORM_COUNT = 2;
const DIRECT_TEXTURE_PAGE_DYNAMIC_UNIFORM_COUNT = 4;

export function createDirectFamilyUniformCache(): DirectFamilyUniformCache {
	return {
		modelViewProjection: new Float32Array(16),
		modelViewProjectionValid: false,
		color: null,
		alphaTest: null,
	};
}

export function resetDirectFamilyUniformCache(
	cache: DirectFamilyUniformCache,
): void {
	cache.modelViewProjectionValid = false;
	cache.color = null;
	cache.alphaTest = null;
}

export function uploadDirectFamilySamplerUniforms({
	context,
	route,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2DirectDrawRoute;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (route.programKind === "texture") {
		context.gl.uniform1i(
			route.activeProgram.uniforms.uTexture,
			context.textureUnits.rgbaTexture,
		);
		context.gl.uniform1i(
			route.activeProgram.uniforms.uDetailTexture,
			context.textureUnits.rgbaDetail,
		);
		metrics.uniformUploadCount += 2;
		return;
	}
	if (isIndexedRoute(route)) {
		uploadIndexedSamplerUniforms(context.gl, route.indexedProgram);
		metrics.uniformUploadCount += 3;
	}
}

export function prepareDirectRgbaTexturePageDraw({
	context,
	route,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2RgbaTexturePageDirectDrawRoute;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	metrics.directTexturePageFallbackSamples = appendSubmitFallbackSamples(
		metrics.directTexturePageFallbackSamples,
		route.drawUnit.texturePageBindingFallbackSamples,
	);
	if (route.texturePageBinding) {
		metrics.directTexturePageDrawCount += 1;
		if (route.texturePageBinding.pageKind === "packed-atlas") {
			metrics.directPackedTexturePageDrawCount += 1;
			metrics.directPackedTexturePageEstimatedBindAvoidedCount += 1;
		} else {
			metrics.directSingleEntryTexturePageDrawCount += 1;
		}
	}
	if (
		route.activeBaseTexture &&
		context.stateCache.bindTexture2D(
			context.textureUnits.rgbaTexture,
			route.activeBaseTexture,
		)
	) {
		metrics.stateChangeCount += 1;
	}
	bindDirectDetailOverlayTexture({ context, route, metrics });
}

export function uploadDirectRgbaTexturePageUniforms({
	context,
	route,
	uniformCache,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2RgbaTexturePageDirectDrawRoute;
	uniformCache: DirectFamilyUniformCache;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	uploadDirectColorUniforms({ context, route, uniformCache, metrics });
	uploadDirectAlphaUniform({ context, route, uniformCache, metrics });
	if (!route.detailProgram) {
		throw new Error(
			`RGBA texture-page draw unit ${route.drawUnit.id} has no detail program.`,
		);
	}
	uploadDetailOverlayUniforms(
		context.gl,
		route.detailProgram,
		route.drawUnit.detailOverlay,
	);
	metrics.uniformUploadCount += DETAIL_DYNAMIC_UNIFORM_COUNT;
	if (route.activeProgram !== route.colorProgram) {
		throw new Error(
			`RGBA texture-page draw unit ${route.drawUnit.id} has inconsistent program routing.`,
		);
	}
	uploadDirectTexturePageUniforms(
		context.gl,
		route.activeProgram,
		route.texturePageBinding,
	);
	metrics.uniformUploadCount += DIRECT_TEXTURE_PAGE_DYNAMIC_UNIFORM_COUNT;
}

export function prepareDirectIndexedPalettedDraw({
	context,
	route,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2IndexedDirectDrawRoute;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!route.drawUnit.directIndexedMaterialResources) {
		throw new Error(
			`Indexed draw unit ${route.drawUnit.id} has no indexed material.`,
		);
	}
	metrics.stateChangeCount += bindIndexedMaterialTextures({
		stateCache: context.stateCache,
		directIndexedMaterialResources:
			route.drawUnit.directIndexedMaterialResources,
	});
	bindDirectDetailOverlayTexture({ context, route, metrics });
}

export function uploadDirectIndexedPalettedUniforms({
	context,
	route,
	uniformCache,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2IndexedDirectDrawRoute;
	uniformCache: DirectFamilyUniformCache;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	uploadDirectColorUniforms({ context, route, uniformCache, metrics });
	uploadDirectAlphaUniform({ context, route, uniformCache, metrics });
	if (!route.indexedProgram || !route.drawUnit.directIndexedMaterialResources) {
		throw new Error(
			`Indexed draw unit ${route.drawUnit.id} has incomplete indexed route data.`,
		);
	}
	uploadIndexedMaterialUniforms(
		context.gl,
		route.indexedProgram,
		route.drawUnit.directIndexedMaterialResources,
	);
	metrics.uniformUploadCount += INDEXED_DYNAMIC_UNIFORM_COUNT;
	if (!route.detailProgram) {
		throw new Error(
			`Indexed draw unit ${route.drawUnit.id} has no detail program.`,
		);
	}
	uploadDetailOverlayUniforms(
		context.gl,
		route.detailProgram,
		route.drawUnit.detailOverlay,
	);
	metrics.uniformUploadCount += DETAIL_DYNAMIC_UNIFORM_COUNT;
}

export function uploadDirectColorUniforms({
	context,
	route,
	uniformCache,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route:
		| Webgl2FlatDirectDrawRoute
		| Webgl2RgbaTexturePageDirectDrawRoute
		| Webgl2IndexedDirectDrawRoute;
	uniformCache: DirectFamilyUniformCache;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!route.colorProgram) {
		throw new Error(`Draw unit ${route.drawUnit.id} has no color program.`);
	}
	if (
		!uniformCache.color ||
		!arraysEqual(uniformCache.color, route.drawUnit.color)
	) {
		context.gl.uniform4fv(
			route.colorProgram.uniforms.uColor,
			route.drawUnit.color,
		);
		uniformCache.color = route.drawUnit.color;
		metrics.uniformUploadCount += 1;
	}
}

export function planWebgl2DirectDrawRoute({
	drawUnit,
	programs,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	programs: Webgl2DirectDrawPrograms;
}): Webgl2DirectDrawRoute {
	const submission = mapWebgl2DrawUnitToDirectRenderFamilySubmission(drawUnit);
	const indexedProgram = resolveIndexedProgram(drawUnit, programs);
	const usesRgbaTexturePage = drawUnit.texture !== null;
	const texturePageBinding =
		usesRgbaTexturePage && drawUnit.texture
			? resolveDrawUnitBaseTexturePageBinding(drawUnit)
			: null;
	const activeBaseTexture =
		texturePageBinding?.texture.texture ?? drawUnit.texture?.texture ?? null;
	if (indexedProgram) {
		return {
			drawUnit,
			submission,
			programKind:
				drawUnit.directIndexedMaterialResources?.descriptor.indexFormat === "p8"
					? "indexed-p8"
					: "indexed-p16",
			activeProgram: indexedProgram,
			indexedProgram,
			colorProgram: indexedProgram,
			alphaProgram: indexedProgram,
			detailProgram: indexedProgram,
			texturePageBinding: null,
			activeBaseTexture: null,
			detailTextureUnit: DIRECT_FAMILY_DRAW_TEXTURE_UNITS.indexedDetail,
		};
	}
	if (usesRgbaTexturePage) {
		return {
			drawUnit,
			submission,
			programKind: "texture",
			activeProgram: programs.rgbaTexturePage,
			indexedProgram: null,
			colorProgram: programs.rgbaTexturePage,
			alphaProgram: programs.rgbaTexturePage,
			detailProgram: programs.rgbaTexturePage,
			texturePageBinding,
			activeBaseTexture,
			detailTextureUnit: DIRECT_FAMILY_DRAW_TEXTURE_UNITS.rgbaDetail,
		};
	}
	return {
		drawUnit,
		submission,
		programKind: "flat",
		activeProgram: programs.flat,
		indexedProgram: null,
		colorProgram: programs.flat,
		alphaProgram: null,
		detailProgram: null,
		texturePageBinding: null,
		activeBaseTexture: null,
		detailTextureUnit: null,
	};
}

function uploadDirectAlphaUniform({
	context,
	route,
	uniformCache,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2RgbaTexturePageDirectDrawRoute | Webgl2IndexedDirectDrawRoute;
	uniformCache: DirectFamilyUniformCache;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!route.alphaProgram) {
		return;
	}
	const alphaTest = route.drawUnit.materialBehavior?.alphaTest ?? 0;
	if (uniformCache.alphaTest !== alphaTest) {
		context.gl.uniform1f(route.alphaProgram.uniforms.uAlphaTest, alphaTest);
		uniformCache.alphaTest = alphaTest;
		metrics.uniformUploadCount += 1;
	}
}

function bindDirectDetailOverlayTexture({
	context,
	route,
	metrics,
}: {
	context: DirectFamilyDrawContext;
	route: Webgl2RgbaTexturePageDirectDrawRoute | Webgl2IndexedDirectDrawRoute;
	metrics: Webgl2WorldSubmitMetrics;
}): void {
	if (!route.drawUnit.detailOverlay) {
		return;
	}
	const unit = route.detailTextureUnit;
	if (
		context.stateCache.bindTexture2D(
			unit,
			route.drawUnit.detailOverlay.texture.texture,
		)
	) {
		metrics.stateChangeCount += 1;
	}
}

function isIndexedRoute(
	route: Webgl2DirectDrawRoute,
): route is Webgl2IndexedDirectDrawRoute {
	return (
		route.programKind === "indexed-p8" || route.programKind === "indexed-p16"
	);
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
	directIndexedMaterialResources,
}: {
	stateCache: Webgl2StateCache;
	directIndexedMaterialResources: NonNullable<
		Webgl2WorldDrawUnit["directIndexedMaterialResources"]
	>;
}): number {
	let changeCount = 0;
	if (
		stateCache.bindTexture2D(
			0,
			directIndexedMaterialResources.indexTexture.texture,
		)
	) {
		changeCount += 1;
	}
	if (
		stateCache.bindTexture2D(
			1,
			directIndexedMaterialResources.paletteTexture.texture,
		)
	) {
		changeCount += 1;
	}
	return changeCount;
}

function resolveDrawUnitBaseTexturePageBinding(
	drawUnit: Webgl2WorldDrawUnit,
): TexturePageResourceBinding | null {
	const binding =
		drawUnit.texturePageBindings.find(
			(candidate) => candidate.usageBucket === "base-color",
		) ?? null;
	return binding && isTexturePageResourceBinding(binding) ? binding : null;
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
	directIndexedMaterialResources: NonNullable<
		Webgl2WorldDrawUnit["directIndexedMaterialResources"]
	>,
): void {
	const descriptor = directIndexedMaterialResources.descriptor;
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
	binding: TexturePageResourceBinding | null,
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

function isTexturePageResourceBinding(
	binding: TexturePageDescriptor,
): binding is TexturePageResourceBinding {
	return "texture" in binding;
}

function resolveIndexedProgram(
	drawUnit: Webgl2WorldDrawUnit,
	programs: Webgl2DirectDrawPrograms,
): Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram | null {
	switch (drawUnit.directIndexedMaterialResources?.descriptor.indexFormat) {
		case "p8":
			return programs.indexedP8;
		case "index16":
			return programs.indexedP16;
		case undefined:
			return null;
	}
}

function arraysEqual(left: Float32Array, right: Float32Array): boolean {
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
