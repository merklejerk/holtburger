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
