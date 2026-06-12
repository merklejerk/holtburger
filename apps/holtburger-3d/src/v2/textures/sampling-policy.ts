import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureSamplingPolicy,
} from "../static/contracts";

export type TextureFilteringMode = "nearest" | "linear" | "anisotropic-4x";

export type TexturePageSampleClass =
	| "rgba-color"
	| "rgba-detail"
	| "rgba-mask"
	| "rgba-exact";

export type TextureWrapMode = "repeat" | "clamp-to-edge";

export interface RuntimeTexturePagePolicy {
	readonly sampleClass: TexturePageSampleClass;
	readonly wrapS: TextureWrapMode;
	readonly wrapT: TextureWrapMode;
}

export interface RuntimeTextureSamplerPolicy {
	readonly filteringMode: TextureFilteringMode;
	readonly generateMipmaps: boolean;
	readonly anisotropy: number;
	readonly policyKey: string;
}

export function createRuntimeTexturePagePolicy(
	source: PreparedRgbaRenderSurfaceTextureUseIdentity,
	samplingPolicy?: StaticBakeTextureSamplingPolicy,
): RuntimeTexturePagePolicy {
	const wrapOverride = samplingPolicy
		? {
				wrapS: samplingPolicy.wrapS,
				wrapT: samplingPolicy.wrapT,
			}
		: null;

	switch (source.usage) {
		case "rgba-color":
			return {
				sampleClass: "rgba-color",
				wrapS: wrapOverride?.wrapS ?? "repeat",
				wrapT: wrapOverride?.wrapT ?? "repeat",
			};
		case "rgba-detail":
			return {
				sampleClass: "rgba-detail",
				wrapS: wrapOverride?.wrapS ?? "repeat",
				wrapT: wrapOverride?.wrapT ?? "repeat",
			};
		case "rgba-mask":
			return {
				sampleClass: "rgba-mask",
				wrapS: wrapOverride?.wrapS ?? "clamp-to-edge",
				wrapT: wrapOverride?.wrapT ?? "clamp-to-edge",
			};
		case "rgba-raw":
			return {
				sampleClass: "rgba-exact",
				wrapS: wrapOverride?.wrapS ?? "clamp-to-edge",
				wrapT: wrapOverride?.wrapT ?? "clamp-to-edge",
			};
	}
}

export function createRuntimeTextureSamplerPolicy(options: {
	readonly sampleClass: TexturePageSampleClass;
	readonly filteringMode: TextureFilteringMode;
}): RuntimeTextureSamplerPolicy {
	const generateMipmaps =
		options.filteringMode !== "nearest" &&
		(options.sampleClass === "rgba-color" ||
			options.sampleClass === "rgba-detail");
	const anisotropy = options.filteringMode === "anisotropic-4x" ? 4 : 1;
	const policyKey = [
		`sample=${options.sampleClass}`,
		`filter=${options.filteringMode}`,
		`mips=${generateMipmaps ? "on" : "off"}`,
		`aniso=${anisotropy}`,
	].join(";");

	return {
		anisotropy,
		filteringMode: options.filteringMode,
		generateMipmaps,
		policyKey,
	};
}
