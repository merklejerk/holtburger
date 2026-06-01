import type { Webgl2Texture2DResource } from "./webgl2-gl";
import type {
	Webgl2TextureAtlasGenerationResource,
	Webgl2TextureAtlasTextureResource,
} from "./webgl2-texture-atlas-generation";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

export type TexturePageKind = "single-entry" | "packed-atlas";
export type TexturePageUsageBucket = "base-color";
export type TexturePageSampleClass = "rgba-color";
export type TexturePageWrapMode = "clamp" | "repeat";

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
	source: "standalone-direct-texture" | "shared-packed-page";
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
			source: "shared-packed-page",
		},
		fallbackSamples,
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
