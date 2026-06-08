export type TexturePageKind = "single-entry" | "packed-atlas";
export type TexturePageEntryRole =
	| "base-color"
	| "detail"
	| "indexed-texels"
	| "palette-lookup"
	| "alpha-control";
export type TexturePageSampleClass =
	| "rgba-color"
	| "indexed-data"
	| "palette-data"
	| "control-data";
export type TexturePageWrapMode = "clamp" | "repeat";
export type TexturePageFilterPolicy = "linear" | "nearest" | "material-policy";
export type TexturePageMipPolicy = "generated" | "none" | "material-policy";
export type TexturePageSamplingDomain = "color" | "data" | "control";
export type TexturePageLookupPolicy =
	| "color-filtered"
	| "exact"
	| "control-filtered";

export const STATIC_TEXTURE_PAGE_BUCKETS = [
	"static-base-color",
	"static-detail",
	"static-indexed-texels",
	"static-palette-lookup",
	"static-alpha-control",
] as const;

export const TERRAIN_TEXTURE_PAGE_BUCKETS = [
	"terrain-color",
	"terrain-mask",
	"terrain-detail",
] as const;

export type StaticTexturePageBucket =
	(typeof STATIC_TEXTURE_PAGE_BUCKETS)[number];

export type TerrainTexturePageBucket =
	(typeof TERRAIN_TEXTURE_PAGE_BUCKETS)[number];

export type TexturePageBucket =
	| StaticTexturePageBucket
	| TerrainTexturePageBucket;

export function isTerrainTexturePageBucket(
	bucket: string,
): bucket is TerrainTexturePageBucket {
	return TERRAIN_TEXTURE_PAGE_BUCKETS.includes(
		bucket as TerrainTexturePageBucket,
	);
}

export function deriveStaticTexturePageBucket(options: {
	role: TexturePageEntryRole;
	sampleClass: TexturePageSampleClass;
}): StaticTexturePageBucket {
	switch (options.role) {
		case "base-color":
			if (options.sampleClass === "rgba-color") {
				return "static-base-color";
			}
			break;
		case "detail":
			if (options.sampleClass === "rgba-color") {
				return "static-detail";
			}
			break;
		case "indexed-texels":
			if (options.sampleClass === "indexed-data") {
				return "static-indexed-texels";
			}
			break;
		case "palette-lookup":
			if (options.sampleClass === "palette-data") {
				return "static-palette-lookup";
			}
			break;
		case "alpha-control":
			if (options.sampleClass === "control-data") {
				return "static-alpha-control";
			}
			break;
	}
	throw new Error(
		`Unsupported static texture page bucket ${options.role}/${options.sampleClass}.`,
	);
}

export interface TexturePageSamplingPolicy {
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	minFilter: TexturePageFilterPolicy;
	magFilter: TexturePageFilterPolicy;
	mip: TexturePageMipPolicy;
	samplingDomain: TexturePageSamplingDomain;
	lookup: TexturePageLookupPolicy;
}

export type TexturePageBindingSource =
	| "standalone-direct-texture"
	| "shared-packed-page"
	| "detail-overlay"
	| "indexed-material"
	| "indexed-material-descriptor";

export interface TexturePageDescriptor {
	pageKind: TexturePageKind;
	role: TexturePageEntryRole;
	sampleClass: TexturePageSampleClass;
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	sampling: TexturePageSamplingPolicy;
	source: TexturePageBindingSource;
}
