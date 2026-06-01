import type { Webgl2Texture2DResource } from "./webgl2-gl";
import type {
	Webgl2TextureAtlasGenerationResource,
	Webgl2TextureAtlasTextureResource,
} from "./webgl2-texture-atlas-generation";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

export type TexturePageKind = "single-entry" | "packed-atlas";
export type TexturePageUsageBucket =
	| "base-color"
	| "detail"
	| "indexed-texels"
	| "palette-lookup"
	| "terrain"
	| "road"
	| "alpha-control";
export type TexturePageSampleClass =
	| "rgba-color"
	| "indexed-data"
	| "palette-data"
	| "control-data";
export type TexturePageWrapMode = "clamp" | "repeat";
export type TexturePageFilterPolicy = "linear" | "nearest" | "material-policy";
export type TexturePageMipPolicy = "generated" | "none" | "material-policy";
export type TexturePageColorSpacePolicy =
	| "linear"
	| "data"
	| "none"
	| "material-policy";
export type TexturePageLookupPolicy =
	| "color-filtered"
	| "exact"
	| "control-filtered";

export interface TexturePageSamplingPolicy {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	minFilter: TexturePageFilterPolicy;
	magFilter: TexturePageFilterPolicy;
	mip: TexturePageMipPolicy;
	colorSpace: TexturePageColorSpacePolicy;
	lookup: TexturePageLookupPolicy;
}

export interface TexturePageBinding {
	pageKind: TexturePageKind;
	usageBucket: TexturePageUsageBucket;
	sampleClass: TexturePageSampleClass;
	texture: Webgl2Texture2DResource;
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	sampling: TexturePageSamplingPolicy;
	source:
		| "standalone-direct-texture"
		| "shared-packed-page"
		| "detail-overlay"
		| "indexed-material"
		| "terrain-blend";
}

export interface TexturePageBindingResolution {
	binding: TexturePageBinding | null;
	fallbackSamples: readonly string[];
}

export function resolveDirectDrawBaseTexturePageBinding({
	drawUnit,
	generation,
	fallbackSamples,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	generation: Webgl2TextureAtlasGenerationResource | null;
	fallbackSamples: readonly string[];
}): TexturePageBindingResolution {
	if (!drawUnit.texture) {
		return { binding: null, fallbackSamples };
	}
	if (drawUnit.atlasEligibility && !drawUnit.detailOverlay && generation) {
		const packedBinding = resolvePackedBaseTexturePageBinding({
			drawUnit,
			generation,
			fallbackSamples,
		});
		if (packedBinding.binding) {
			return packedBinding;
		}
		fallbackSamples = packedBinding.fallbackSamples;
	} else if (drawUnit.atlasEligibility && drawUnit.detailOverlay) {
		fallbackSamples = appendTexturePageFallbackSample(
			fallbackSamples,
			"direct packed base page requires standalone detail overlay path",
		);
	} else if (drawUnit.atlasEligibility && !generation) {
		fallbackSamples = appendTexturePageFallbackSample(
			fallbackSamples,
			"direct packed base page missing texture atlas generation",
		);
	}
	const wrapMode = resolveTexturePageWrapMode(drawUnit);
	return {
		binding: {
			pageKind: "single-entry",
			usageBucket: "base-color",
			sampleClass: "rgba-color",
			texture: drawUnit.texture,
			rect: [0, 0, drawUnit.texture.width, drawUnit.texture.height],
			width: drawUnit.texture.width,
			height: drawUnit.texture.height,
			wrapS: wrapMode.wrapS,
			wrapT: wrapMode.wrapT,
			sampling: colorTexturePageSamplingPolicy(wrapMode),
			source: "standalone-direct-texture",
		},
		fallbackSamples,
	};
}

function resolvePackedBaseTexturePageBinding({
	drawUnit,
	generation,
	fallbackSamples,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	generation: Webgl2TextureAtlasGenerationResource;
	fallbackSamples: readonly string[];
}): TexturePageBindingResolution {
	const placement = generation.placements.find(
		(candidate) =>
			candidate.atlasEntryKey === drawUnit.atlasEligibility?.atlasEntryKey,
	);
	if (!placement) {
		return fallback(
			fallbackSamples,
			`direct packed base page missing placed entry ${drawUnit.atlasEligibility?.atlasEntryKey ?? "unknown"}`,
		);
	}
	const page = generation.textures.find(
		(candidate) => candidate.textureIndex === placement.textureIndex,
	);
	if (!page) {
		return fallback(
			fallbackSamples,
			`direct packed base page missing texture ${placement.textureIndex} for ${placement.atlasEntryKey}`,
		);
	}
	const wrapMode = resolveTexturePageWrapMode(drawUnit);
	return {
		binding: {
			pageKind: "packed-atlas",
			usageBucket: "base-color",
			sampleClass: "rgba-color",
			texture: pageTexture(page),
			rect: placement.rect,
			width: placement.width,
			height: placement.height,
			wrapS: wrapMode.wrapS,
			wrapT: wrapMode.wrapT,
			sampling: colorTexturePageSamplingPolicy(wrapMode),
			source: "shared-packed-page",
		},
		fallbackSamples,
	};
}

export function collectDirectDrawTexturePageBindings(
	drawUnit: Pick<
		Webgl2WorldDrawUnit,
		| "texture"
		| "textureSamplingPolicy"
		| "atlasEligibility"
		| "detailOverlay"
		| "indexedMaterial"
		| "terrainBlend"
	>,
): readonly TexturePageBinding[] {
	const baseWrap = resolveTexturePageWrapMode(drawUnit);
	return [
		...(drawUnit.texture
			? [
					createSingleEntryTexturePageBinding({
						texture: drawUnit.texture,
						usageBucket: "base-color",
						sampleClass: "rgba-color",
						wrapS: baseWrap.wrapS,
						wrapT: baseWrap.wrapT,
						sampling: colorTexturePageSamplingPolicy(baseWrap),
						source: "standalone-direct-texture",
					}),
				]
			: []),
		...(drawUnit.detailOverlay
			? [
					createSingleEntryTexturePageBinding({
						texture: drawUnit.detailOverlay.texture,
						usageBucket: "detail",
						sampleClass: "rgba-color",
						wrapS: "repeat",
						wrapT: "repeat",
						sampling: colorTexturePageSamplingPolicy({
							wrapS: "repeat",
							wrapT: "repeat",
						}),
						source: "detail-overlay",
					}),
				]
			: []),
		...(drawUnit.indexedMaterial
			? [
					createSingleEntryTexturePageBinding({
						texture: drawUnit.indexedMaterial.indexTexture,
						usageBucket: "indexed-texels",
						sampleClass: "indexed-data",
						wrapS: drawUnit.indexedMaterial.wrapS,
						wrapT: drawUnit.indexedMaterial.wrapT,
						sampling: exactDataTexturePageSamplingPolicy({
							wrapS: drawUnit.indexedMaterial.wrapS,
							wrapT: drawUnit.indexedMaterial.wrapT,
						}),
						source: "indexed-material",
					}),
					createSingleEntryTexturePageBinding({
						texture: drawUnit.indexedMaterial.paletteTexture,
						usageBucket: "palette-lookup",
						sampleClass: "palette-data",
						wrapS: "clamp",
						wrapT: "clamp",
						sampling: exactDataTexturePageSamplingPolicy({
							wrapS: "clamp",
							wrapT: "clamp",
						}),
						source: "indexed-material",
					}),
				]
			: []),
		...(drawUnit.terrainBlend
			? collectTerrainBlendTexturePageBindings(drawUnit.terrainBlend)
			: []),
	];
}

function collectTerrainBlendTexturePageBindings(
	terrainBlend: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>,
): readonly TexturePageBinding[] {
	return [
		createTerrainTexturePageBinding(terrainBlend.base, "terrain", "rgba-color"),
		...terrainBlend.overlays.flatMap((overlay) => [
			createTerrainTexturePageBinding(overlay.terrain, "terrain", "rgba-color"),
			createTerrainTexturePageBinding(
				overlay.alpha,
				"alpha-control",
				"control-data",
			),
		]),
		...terrainBlend.roads.flatMap((road) => [
			createTerrainTexturePageBinding(road.road, "road", "rgba-color"),
			createTerrainTexturePageBinding(
				road.alpha,
				"alpha-control",
				"control-data",
			),
		]),
	];
}

function createTerrainTexturePageBinding(
	binding: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>["base"],
	usageBucket: TexturePageUsageBucket,
	sampleClass: TexturePageSampleClass,
): TexturePageBinding {
	const wrap = {
		wrapS: binding.wrapS,
		wrapT: binding.wrapT,
	};
	return createSingleEntryTexturePageBinding({
		texture: binding.texture,
		usageBucket,
		sampleClass,
		wrapS: binding.wrapS,
		wrapT: binding.wrapT,
		sampling:
			sampleClass === "control-data"
				? controlTexturePageSamplingPolicy(wrap)
				: colorTexturePageSamplingPolicy(wrap),
		source: "terrain-blend",
	});
}

function createSingleEntryTexturePageBinding({
	texture,
	usageBucket,
	sampleClass,
	wrapS,
	wrapT,
	sampling,
	source,
}: {
	texture: Webgl2Texture2DResource;
	usageBucket: TexturePageUsageBucket;
	sampleClass: TexturePageSampleClass;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	sampling: TexturePageSamplingPolicy;
	source: TexturePageBinding["source"];
}): TexturePageBinding {
	return {
		pageKind: "single-entry",
		usageBucket,
		sampleClass,
		texture,
		rect: [0, 0, texture.width, texture.height],
		width: texture.width,
		height: texture.height,
		wrapS,
		wrapT,
		sampling,
		source,
	};
}

function colorTexturePageSamplingPolicy({
	wrapS,
	wrapT,
}: {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
}): TexturePageSamplingPolicy {
	return {
		wrapS,
		wrapT,
		minFilter: "linear",
		magFilter: "linear",
		mip: "material-policy",
		colorSpace: "linear",
		lookup: "color-filtered",
	};
}

function exactDataTexturePageSamplingPolicy({
	wrapS,
	wrapT,
}: {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
}): TexturePageSamplingPolicy {
	return {
		wrapS,
		wrapT,
		minFilter: "nearest",
		magFilter: "nearest",
		mip: "none",
		colorSpace: "data",
		lookup: "exact",
	};
}

function controlTexturePageSamplingPolicy({
	wrapS,
	wrapT,
}: {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
}): TexturePageSamplingPolicy {
	return {
		wrapS,
		wrapT,
		minFilter: "material-policy",
		magFilter: "material-policy",
		mip: "material-policy",
		colorSpace: "none",
		lookup: "control-filtered",
	};
}

function pageTexture(
	page: Webgl2TextureAtlasTextureResource,
): Webgl2Texture2DResource {
	return page.texture;
}

function fallback(
	fallbackSamples: readonly string[],
	sample: string,
): TexturePageBindingResolution {
	return {
		binding: null,
		fallbackSamples: appendTexturePageFallbackSample(fallbackSamples, sample),
	};
}

function appendTexturePageFallbackSample(
	fallbackSamples: readonly string[],
	sample: string,
): readonly string[] {
	return [...fallbackSamples, sample].slice(0, 8);
}

function resolveTexturePageWrapMode(drawUnit: Webgl2WorldDrawUnit): {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
} {
	const samplingPolicy = drawUnit.atlasEligibility?.samplingPolicy;
	if (samplingPolicy) {
		return {
			wrapS: samplingPolicy.wrapS,
			wrapT: samplingPolicy.wrapT,
		};
	}
	const match = drawUnit.textureSamplingPolicy?.match(/wrap=([^/;]+)\/([^;]+)/);
	return {
		wrapS: match?.[1] === "repeat" ? "repeat" : "clamp",
		wrapT: match?.[2] === "repeat" ? "repeat" : "clamp",
	};
}
