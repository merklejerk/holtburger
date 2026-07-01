import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureSamplingPolicy,
} from "../contracts";
import type {
	TextureBindingRequirement,
	TexturePlacementPool,
	TexturePlacementSource,
} from "../../textures/placement";
import { classifyTextureUsagePurpose } from "../../textures/placement";

export type StaticMaterialTextureWrapMode = "clamp" | "repeat";

export function createMaterialTextureDataUseKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "palette-texture-use") {
		return [
			dataUse.kind,
			formatHex32(dataUse.palette.paletteId),
			`range:${dataUse.firstIndex}-${dataUse.indexCount}`,
			createPaletteTextureSubPalettesKey(dataUse.subPalettes ?? []),
			dataUse.usage,
		].join(":");
	}

	return [
		dataUse.kind,
		formatHex32(dataUse.renderSurface.renderSurfaceId),
		dataUse.usage,
	].join(":");
}

export function createStaticMaterialTextureUseId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticMaterialTextureWrapMode;
}): string {
	const samplingPolicy = createStaticMaterialTextureSamplingPolicy({
		dataUse: options.dataUse,
		wrapMode: options.wrapMode,
	});

	return [
		options.textureUseScopeId,
		options.textureUseNamespace,
		createMaterialTextureDataUseKey(options.dataUse),
		createStaticMaterialTextureSamplingPolicyKey(samplingPolicy),
	].join(":");
}

export function createStaticMaterialTextureBindingRequirement(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticMaterialTextureWrapMode;
	readonly pool?: Extract<
		TexturePlacementPool,
		"runtime-authored-object" | "static-authored-object"
	>;
}): TextureBindingRequirement {
	const samplingPolicy = createStaticMaterialTextureSamplingPolicy({
		dataUse: options.dataUse,
		wrapMode: options.wrapMode,
	});
	const bindingKey = createStaticMaterialTextureUseId(options);

	return {
		bindingKey,
		// Phase 12 keeps the current renderer binding key as the placement item id.
		// The equality is now local to this bridge rather than ambient pipeline state.
		placementItemId: bindingKey,
		purpose: classifyTextureUsagePurpose(
			options.dataUse,
			options.pool ?? "static-authored-object",
		),
		samplingPolicy,
		source: createStaticMaterialTexturePlacementSource(
			options.dataUse,
			samplingPolicy,
		),
		sourceKey: createMaterialTextureDataUseKey(options.dataUse),
	};
}

export function createStaticMaterialTextureSamplingPolicy(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly wrapMode: StaticMaterialTextureWrapMode;
}): StaticBakeTextureSamplingPolicy {
	if (shouldRepeatStaticMaterialTextureUse(options)) {
		return {
			wrapS: "repeat",
			wrapT: "repeat",
		};
	}

	return {
		wrapS: "clamp-to-edge",
		wrapT: "clamp-to-edge",
	};
}

function createStaticMaterialTextureSamplingPolicyKey(
	policy: StaticBakeTextureSamplingPolicy,
): string {
	return `sampling:wrap=${policy.wrapS},${policy.wrapT}`;
}

export function resolveRepeatedStaticMaterialPrimaryWrapMode(
	dataUses: readonly MaterialTextureDataUseIdentity[],
): StaticMaterialTextureWrapMode {
	return dataUses.some(isPrimaryTextureDataUse) ? "repeat" : "clamp";
}

function isPrimaryTextureDataUse(
	dataUse: MaterialTextureDataUseIdentity,
): boolean {
	return (
		dataUse.kind === "prepared-render-surface-texture-use" &&
		(dataUse.usage === "rgba-color" ||
			dataUse.usage === "index8" ||
			dataUse.usage === "index16")
	);
}

function shouldRepeatStaticMaterialTextureUse(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly wrapMode: StaticMaterialTextureWrapMode;
}): boolean {
	if (options.dataUse.kind === "palette-texture-use") {
		return false;
	}

	switch (options.dataUse.usage) {
		case "rgba-color":
		case "index8":
		case "index16":
			return options.wrapMode === "repeat";
		case "rgba-detail":
			return true;
		case "rgba-mask":
		case "rgba-raw":
			return false;
	}
}

function createStaticMaterialTexturePlacementSource(
	dataUse: MaterialTextureDataUseIdentity,
	samplingPolicy: StaticBakeTextureSamplingPolicy,
): TexturePlacementSource {
	return {
		dataUse,
		kind: "material-texture-data-use",
		samplingPolicy,
	};
}

function createPaletteTextureSubPalettesKey(
	subPalettes: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "palette-texture-use" }
	>["subPalettes"],
): string {
	if (subPalettes.length === 0) {
		return "sub:none";
	}
	return [
		"sub",
		...subPalettes.map(
			(subPalette) =>
				`${formatHex32(subPalette.palette.paletteId)}@${subPalette.firstIndex}+${subPalette.indexCount}`,
		),
	].join(":");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
