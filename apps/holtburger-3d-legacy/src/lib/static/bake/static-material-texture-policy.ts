import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureSamplingPolicy,
	VisualTextureDomain,
} from "../contracts";
import type {
	TextureBindingRequirement,
	TexturePlacementSource,
} from "../../textures/placement";
import { classifyTextureUsagePurpose } from "../../textures/placement";
import {
	createTextureBindingId,
	type TextureBindingId,
} from "../../textures/identity";

export type StaticMaterialTextureWrapMode = "clamp" | "repeat";

export function createMaterialTextureDataUseKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "prepared-palette-texture-use") {
		return [
			dataUse.kind,
			formatHex32(dataUse.palette.paletteId),
			`domain:${dataUse.domain}`,
			createPreparedPaletteReplacementsKey(dataUse.replacements),
			dataUse.usage,
		].join(":");
	}

	return [
		dataUse.kind,
		formatHex32(dataUse.renderSurface.renderSurfaceId),
		dataUse.usage,
	].join(":");
}

export function createStaticMaterialTextureBindingId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticMaterialTextureWrapMode;
	readonly domain: VisualTextureDomain;
}): TextureBindingId {
	return createTextureBindingId({
		resourceId: `${options.textureUseScopeId}:${options.textureUseNamespace}`,
		role: classifyTextureUsagePurpose(options.dataUse, options.domain),
		slot: createMaterialTextureDataUseKey(options.dataUse),
		wrapMode: createStaticMaterialTextureSamplingPolicy({
			dataUse: options.dataUse,
			wrapMode: options.wrapMode,
		}).wrapS,
	});
}

export function createStaticMaterialTextureBindingRequirement(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticMaterialTextureWrapMode;
	/** Renderer texture domain used to derive the shader/page purpose. */
	readonly domain: VisualTextureDomain;
}): TextureBindingRequirement {
	const samplingPolicy = createStaticMaterialTextureSamplingPolicy({
		dataUse: options.dataUse,
		wrapMode: options.wrapMode,
	});
	const bindingId = createStaticMaterialTextureBindingId(options);

	return {
		bindingId,
		placementItemId: bindingId,
		purpose: classifyTextureUsagePurpose(options.dataUse, options.domain),
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
	if (options.dataUse.kind === "prepared-palette-texture-use") {
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

function createPreparedPaletteReplacementsKey(
	replacements: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-palette-texture-use" }
	>["replacements"],
): string {
	if (replacements.length === 0) {
		return "repl:none";
	}
	return [
		"repl",
		...replacements.map(
			(replacement) =>
				`${formatHex32(replacement.palette.paletteId)}@${replacement.offset}+${replacement.count}`,
		),
	].join(":");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
