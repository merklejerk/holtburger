import type { PreparedAssetReader } from "../assets/contracts";
import type {
	MaterialTextureDataUseIdentity,
	VisualTextureDomain,
} from "../static/contracts";
import {
	createMaterialTextureSourceKey,
	createTextureKey,
	createTexturePageClass,
	type MaterialTextureSourceKey,
	type TextureKey,
	type TexturePageClass,
} from "./identity";
import { createStaticPaletteReplacementRecipeKey } from "./palette-replacement-recipe";
import {
	createRuntimeTexturePagePolicy,
	type RuntimeTexturePagePolicy,
} from "./sampling-policy";
import type { StaticBakeTextureSamplingPolicy } from "../static/contracts";
import type { TextureUsagePurpose } from "./placement";

const EXACT_ATLAS_GUTTER_PIXELS = 0;
const FILTERABLE_ATLAS_GUTTER_PIXELS = 4;
const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;

export interface MaterialTextureIdentityFacts {
	/** Canonical source identity before output and shader interpretation facts. */
	readonly sourceKey: MaterialTextureSourceKey;
	/** Canonical texture-pool identity. This excludes owner, binding, and sampler policy. */
	readonly textureKey: TextureKey;
	/** Physical page compatibility class used by atlas placement. */
	readonly pageClass: TexturePageClass;
	/** Current runtime page policy retained for the existing placement machinery. */
	readonly pagePolicy: RuntimeTexturePagePolicy;
}

export async function createMaterialTextureIdentityFacts(input: {
	readonly assetReader: PreparedAssetReader;
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly domain: VisualTextureDomain;
	readonly purpose: TextureUsagePurpose;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
}): Promise<MaterialTextureIdentityFacts> {
	const pagePolicy = createRuntimeTexturePagePolicy(
		input.dataUse,
		input.samplingPolicy,
	);
	const sourceKey = await createMaterialTextureIdentitySourceKey({
		assetReader: input.assetReader,
		dataUse: input.dataUse,
	});

	return {
		pageClass: createTexturePageClass({
			domain: input.domain,
			format: createTextureOutputFormat(input.dataUse),
			gutterPixels: getRuntimeTexturePageGutterPixels(input.domain, pagePolicy),
			physicalWrapMode: createPhysicalTexturePageWrapMode(
				input.domain,
				pagePolicy,
			),
			purpose: input.purpose,
			sampleClass: pagePolicy.sampleClass,
		}),
		pagePolicy,
		sourceKey,
		textureKey: createTextureKey({
			outputFormat: createTextureOutputFormat(input.dataUse),
			sampleClass: pagePolicy.sampleClass,
			sourceKey,
		}),
	};
}

async function createMaterialTextureIdentitySourceKey(input: {
	readonly assetReader: PreparedAssetReader;
	readonly dataUse: MaterialTextureDataUseIdentity;
}): Promise<MaterialTextureSourceKey> {
	if (input.dataUse.kind === "prepared-palette-texture-use") {
		return createMaterialTextureSourceKey({
			basePaletteId: input.dataUse.palette.paletteId,
			domain: input.dataUse.domain,
			kind: "palette",
			replacementRecipeKey: await createStaticPaletteReplacementRecipeKey({
				assetReader: input.assetReader,
				replacements: input.dataUse.replacements,
			}),
			usage: input.dataUse.usage,
		});
	}

	return createMaterialTextureSourceKey({
		kind: "render-surface",
		renderSurfaceId: input.dataUse.renderSurface.renderSurfaceId,
		usage: input.dataUse.usage,
	});
}

function createTextureOutputFormat(
	dataUse: MaterialTextureDataUseIdentity,
): "rgba8" | "index8" | "index16" {
	if (dataUse.kind === "prepared-palette-texture-use") {
		return "rgba8";
	}

	switch (dataUse.usage) {
		case "index8":
			return "index8";
		case "index16":
			return "index16";
		case "rgba-color":
		case "rgba-detail":
		case "rgba-mask":
		case "rgba-raw":
			return "rgba8";
	}
}

function createPhysicalTexturePageWrapMode(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): RuntimeTexturePagePolicy["wrapS"] | undefined {
	if (usesShaderVirtualWrap(domain, pagePolicy)) {
		return undefined;
	}
	if (pagePolicy.wrapS !== pagePolicy.wrapT) {
		throw new Error(
			`Texture page class cannot encode mixed physical wrap modes ${pagePolicy.wrapS},${pagePolicy.wrapT}.`,
		);
	}
	return pagePolicy.wrapS;
}

function usesShaderVirtualWrap(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): boolean {
	return domain !== "outdoor-terrain" && pagePolicy.sampleClass !== "rgba-mask";
}

export function getRuntimeTexturePageGutterPixels(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): number {
	if (domain === "outdoor-terrain") {
		if (pagePolicy.sampleClass === "rgba-color") {
			return Math.max(
				FILTERABLE_ATLAS_GUTTER_PIXELS,
				TERRAIN_COLOR_ATLAS_GUTTER_PIXELS,
			);
		}

		if (pagePolicy.sampleClass === "rgba-mask") {
			return Math.max(
				EXACT_ATLAS_GUTTER_PIXELS,
				TERRAIN_MASK_ATLAS_GUTTER_PIXELS,
			);
		}
	}

	return pagePolicy.sampleClass === "rgba-color" ||
		pagePolicy.sampleClass === "rgba-detail"
		? FILTERABLE_ATLAS_GUTTER_PIXELS
		: EXACT_ATLAS_GUTTER_PIXELS;
}
