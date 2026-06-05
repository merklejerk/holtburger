import type { Webgl2Texture2DResource } from "../webgl2-gl";
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
type TexturePageLookupPolicy = "color-filtered" | "exact" | "control-filtered";

interface TexturePageSamplingPolicy {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	minFilter: TexturePageFilterPolicy;
	magFilter: TexturePageFilterPolicy;
	mip: TexturePageMipPolicy;
	samplingDomain: TexturePageSamplingDomain;
	lookup: TexturePageLookupPolicy;
}

type TexturePageBindingSource =
	| "standalone-direct-texture"
	| "shared-packed-page"
	| "detail-overlay"
	| "indexed-material"
	| "indexed-material-descriptor";

export interface TexturePageDescriptor {
	pageKind: TexturePageKind;
	usageBucket: TexturePageUsageBucket;
	sampleClass: TexturePageSampleClass;
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	sampling: TexturePageSamplingPolicy;
	source: TexturePageBindingSource;
}

export interface TexturePageResourceBinding extends TexturePageDescriptor {
	texture: Webgl2Texture2DResource;
	source: Exclude<TexturePageBindingSource, "indexed-material-descriptor">;
}

export function collectDirectDrawTexturePageBindings(
	drawUnit: Pick<
		Webgl2WorldDrawUnit,
		| "texture"
		| "directTextureSamplingPolicy"
		| "texturePageReadiness"
		| "detailOverlay"
		| "directIndexedMaterialResources"
		| "indexedMaterialDescriptor"
	>,
): readonly TexturePageDescriptor[] {
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
		...(drawUnit.directIndexedMaterialResources
			? [
					createSingleEntryTexturePageBinding({
						texture: drawUnit.directIndexedMaterialResources.indexTexture,
						usageBucket: "indexed-texels",
						sampleClass: "indexed-data",
						wrapS: drawUnit.directIndexedMaterialResources.descriptor.wrapS,
						wrapT: drawUnit.directIndexedMaterialResources.descriptor.wrapT,
						sampling: exactDataTexturePageSamplingPolicy({
							wrapS: drawUnit.directIndexedMaterialResources.descriptor.wrapS,
							wrapT: drawUnit.directIndexedMaterialResources.descriptor.wrapT,
						}),
						source: "indexed-material",
					}),
					createSingleEntryTexturePageBinding({
						texture: drawUnit.directIndexedMaterialResources.paletteTexture,
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
			: drawUnit.indexedMaterialDescriptor
				? [
						createDescriptorTexturePageBinding({
							width: drawUnit.indexedMaterialDescriptor.width,
							height: drawUnit.indexedMaterialDescriptor.height,
							usageBucket: "indexed-texels",
							sampleClass: "indexed-data",
							wrapS: drawUnit.indexedMaterialDescriptor.wrapS,
							wrapT: drawUnit.indexedMaterialDescriptor.wrapT,
							sampling: exactDataTexturePageSamplingPolicy({
								wrapS: drawUnit.indexedMaterialDescriptor.wrapS,
								wrapT: drawUnit.indexedMaterialDescriptor.wrapT,
							}),
						}),
						createDescriptorTexturePageBinding({
							width: drawUnit.indexedMaterialDescriptor.paletteColorCount,
							height: 1,
							usageBucket: "palette-lookup",
							sampleClass: "palette-data",
							wrapS: "clamp",
							wrapT: "clamp",
							sampling: exactDataTexturePageSamplingPolicy({
								wrapS: "clamp",
								wrapT: "clamp",
							}),
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
	source: TexturePageResourceBinding["source"];
}): TexturePageResourceBinding {
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

function createDescriptorTexturePageBinding({
	width,
	height,
	usageBucket,
	sampleClass,
	wrapS,
	wrapT,
	sampling,
}: {
	width: number;
	height: number;
	usageBucket: TexturePageUsageBucket;
	sampleClass: TexturePageSampleClass;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	sampling: TexturePageSamplingPolicy;
}): TexturePageDescriptor {
	return {
		pageKind: "single-entry",
		usageBucket,
		sampleClass,
		rect: [0, 0, width, height],
		width,
		height,
		wrapS,
		wrapT,
		sampling,
		source: "indexed-material-descriptor",
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
