import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureSamplingPolicy,
} from "../static/contracts";

export type TextureFilteringMode = "nearest" | "linear" | "anisotropic-4x";

export type TexturePageSampleClass =
	| "index8"
	| "index16"
	| "palette-rgba"
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
	source: MaterialTextureDataUseIdentity,
	samplingPolicy?: StaticBakeTextureSamplingPolicy,
): RuntimeTexturePagePolicy {
	const wrapOverride = samplingPolicy
		? {
				wrapS: samplingPolicy.wrapS,
				wrapT: samplingPolicy.wrapT,
			}
		: null;

	if (source.kind === "prepared-palette-texture-use") {
		return {
			sampleClass: "palette-rgba",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		};
	}

	switch (source.usage) {
		case "index8":
			return {
				sampleClass: "index8",
				wrapS: wrapOverride?.wrapS ?? "clamp-to-edge",
				wrapT: wrapOverride?.wrapT ?? "clamp-to-edge",
			};
		case "index16":
			return {
				sampleClass: "index16",
				wrapS: wrapOverride?.wrapS ?? "clamp-to-edge",
				wrapT: wrapOverride?.wrapT ?? "clamp-to-edge",
			};
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
	const filteringMode = isDataSampleClass(options.sampleClass)
		? "nearest"
		: options.filteringMode;
	const generateMipmaps =
		filteringMode !== "nearest" &&
		(options.sampleClass === "rgba-color" ||
			options.sampleClass === "rgba-detail");
	const anisotropy = filteringMode === "anisotropic-4x" ? 4 : 1;
	const policyKey = [
		`sample=${options.sampleClass}`,
		`filter=${filteringMode}`,
		`mips=${generateMipmaps ? "on" : "off"}`,
		`aniso=${anisotropy}`,
	].join(";");

	return {
		anisotropy,
		filteringMode,
		generateMipmaps,
		policyKey,
	};
}

function isDataSampleClass(sampleClass: TexturePageSampleClass): boolean {
	return (
		sampleClass === "index8" ||
		sampleClass === "index16" ||
		sampleClass === "palette-rgba"
	);
}
