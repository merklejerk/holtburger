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
export type TexturePageSamplingDomain = "color" | "data" | "control";
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
