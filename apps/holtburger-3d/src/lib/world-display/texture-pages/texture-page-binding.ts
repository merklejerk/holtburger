import type { Webgl2Texture2DResource } from "../webgl2-gl";
import type {
	Webgl2TextureAtlasGenerationResource,
	Webgl2TextureAtlasTextureResource,
} from "../webgl2/resources/texture-atlas-generation";
import type { TexturePageAtlasPlan } from "./texture-page-atlas-planner";
import type { Webgl2WorldDrawUnit } from "../webgl2-world-resources";

type TexturePageWrapDrawUnit = Pick<
	Webgl2WorldDrawUnit,
	"texturePageReadiness" | "directTextureSamplingPolicy"
>;

type TexturePageKind = "single-entry" | "packed-atlas";
export type TexturePageUsageBucket =
	| "base-color"
	| "detail"
	| "indexed-texels"
	| "palette-lookup"
	| "terrain"
	| "road"
	| "alpha-control";
type TexturePageSampleClass =
	| "rgba-color"
	| "indexed-data"
	| "palette-data"
	| "control-data";
type TexturePageWrapMode = "clamp" | "repeat";
type TexturePageFilterPolicy = "linear" | "nearest" | "material-policy";
type TexturePageMipPolicy = "generated" | "none" | "material-policy";
type TexturePageSamplingDomain = "color" | "data" | "control";
type TexturePageLookupPolicy =
	| "color-filtered"
	| "exact"
	| "control-filtered";

interface TexturePageSamplingPolicy {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	minFilter: TexturePageFilterPolicy;
	magFilter: TexturePageFilterPolicy;
	mip: TexturePageMipPolicy;
	samplingDomain: TexturePageSamplingDomain;
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
		| "indexed-material";
}

export interface TexturePageBindingResolution {
	binding: TexturePageBinding | null;
	fallbackSamples: readonly string[];
}

export function resolveDirectDrawBaseTexturePageBinding({
	drawUnit,
	generation,
	atlasPlan,
	fallbackSamples,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	generation: Webgl2TextureAtlasGenerationResource | null;
	atlasPlan: TexturePageAtlasPlan | null;
	fallbackSamples: readonly string[];
}): TexturePageBindingResolution {
	if (!drawUnit.texture) {
		return { binding: null, fallbackSamples };
	}
	if (drawUnit.texturePageReadiness && !drawUnit.detailOverlay && generation) {
		const packedBinding = resolvePackedBaseTexturePageBinding({
			drawUnit,
			generation,
			atlasPlan,
			fallbackSamples,
		});
		if (packedBinding.binding) {
			return packedBinding;
		}
		fallbackSamples = packedBinding.fallbackSamples;
	} else if (drawUnit.texturePageReadiness && drawUnit.detailOverlay) {
		fallbackSamples = appendTexturePageFallbackSample(
			fallbackSamples,
			"direct packed base page requires standalone detail overlay path",
		);
	} else if (drawUnit.texturePageReadiness && !generation) {
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
	atlasPlan,
	fallbackSamples,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	generation: Webgl2TextureAtlasGenerationResource;
	atlasPlan: TexturePageAtlasPlan | null;
	fallbackSamples: readonly string[];
}): TexturePageBindingResolution {
	const placement = generation.placements.find(
		(candidate) =>
			candidate.atlasEntryKey === drawUnit.texturePageReadiness?.atlasEntryKey,
	);
	if (!placement) {
		return fallback(
			fallbackSamples,
			describeMissingPackedBasePlacement({ drawUnit, atlasPlan }),
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

function describeMissingPackedBasePlacement({
	drawUnit,
	atlasPlan,
}: {
	drawUnit: Webgl2WorldDrawUnit;
	atlasPlan: TexturePageAtlasPlan | null;
}): string {
	const atlasEntryKey = drawUnit.texturePageReadiness?.atlasEntryKey ?? "unknown";
	const atlasFailure = atlasPlan?.failures.find(
		(failure) =>
			failure.drawUnitId === drawUnit.id &&
			(failure.reason === "source-texture-too-large" ||
				failure.reason === "atlas-full" ||
				failure.reason === "detail-atlas-full"),
	);
	if (atlasFailure) {
		return `direct packed base page atlas placement unavailable ${atlasEntryKey} (${atlasFailure.reason})`;
	}
	const plannedEntry = atlasPlan?.atlasEntryRecords.some(
		(record) => record.key === atlasEntryKey,
	);
	if (plannedEntry) {
		return `direct packed base page atlas generation missing promised placement ${atlasEntryKey}`;
	}
	return `direct packed base page entry not atlas-planned for retained direct material ${atlasEntryKey}`;
}

export function collectDirectDrawTexturePageBindings(
	drawUnit: Pick<
		Webgl2WorldDrawUnit,
		| "texture"
		| "directTextureSamplingPolicy"
		| "texturePageReadiness"
		| "detailOverlay"
		| "indexedMaterial"
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
	];
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
		samplingDomain: "color",
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
		samplingDomain: "data",
		lookup: "exact",
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

function resolveTexturePageWrapMode(drawUnit: TexturePageWrapDrawUnit): {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
} {
	const samplingPolicy = drawUnit.texturePageReadiness?.samplingPolicy;
	if (samplingPolicy) {
		return {
			wrapS: samplingPolicy.wrapS,
			wrapT: samplingPolicy.wrapT,
		};
	}
	return {
		wrapS: drawUnit.directTextureSamplingPolicy?.wrapS ?? "clamp",
		wrapT: drawUnit.directTextureSamplingPolicy?.wrapT ?? "clamp",
	};
}
