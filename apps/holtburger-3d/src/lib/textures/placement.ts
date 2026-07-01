import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureSamplingPolicy,
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";

/** Shader/page purpose used to group compatible placement items before baking. */
export type TextureUsagePurpose =
	| "object-base-color"
	| "object-detail"
	| "object-index"
	| "object-palette"
	| "terrain-color"
	| "terrain-detail"
	| "terrain-mask";

/** TextureManager pool that separates incompatible atlas policy and churn profiles. */
export type TexturePlacementPool =
	| "runtime-authored-object"
	| "static-authored-object"
	| "terrain";

/**
 * Current prepared/material texture source carried losslessly through the
 * placement bridge. Placement identity is carried separately as `itemId`.
 */
export interface TexturePlacementMaterialSource {
	readonly kind: "material-texture-data-use";
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
}

/** Source bytes or prepared texture identity for one placement item. */
export type TexturePlacementSource = TexturePlacementMaterialSource;

/** Texture binding need shared by placement planning, bakers, and dependency emission. */
export interface TextureBindingRequirement {
	/** Material-entry key referenced by draw units and renderer binding lookup. */
	readonly bindingKey: string;
	/** Packer/placement snapshot key and texture-resource dependency item id. */
	readonly placementItemId: string;
	/** Source dedupe key, including palette/subpalette identity where applicable. */
	readonly sourceKey: string;
	/** Shader/page purpose for the placement item. */
	readonly purpose: TextureUsagePurpose;
	/** Prepared/material source facts needed to build atlas pixels. */
	readonly source: TexturePlacementSource;
	/** Sampling policy carried by the current material texture bridge, if any. */
	readonly samplingPolicy: StaticBakeTextureSamplingPolicy | undefined;
}

/** CPU-side request for TextureManager to assign one opaque item to an atlas page. */
export interface TexturePlacementIntent {
	/** Opaque placement item id used by the packer and baker placement snapshot. */
	readonly itemId: string;
	/** Page compatibility and shader role for the item. */
	readonly purpose: TextureUsagePurpose;
	/** Atlas policy/churn pool the item belongs to. */
	readonly pool: TexturePlacementPool;
	/** Opaque packer clustering hint owned by the caller. */
	readonly affinityKey: string | null;
	/** Prepared/material source facts needed to build atlas pixels. */
	readonly source: TexturePlacementSource;
}

/** CPU-side atlas assignment for one placement item. */
export interface TexturePlacement {
	readonly itemId: string;
	readonly purpose: TextureUsagePurpose;
	readonly pool: TexturePlacementPool;
	readonly pageId: string;
	readonly rect: readonly [number, number, number, number];
	readonly width: number;
	readonly height: number;
}

/** Compact baker input keyed by placement item id. */
export interface TexturePlacementSnapshot {
	readonly placementsByItemId: ReadonlyMap<string, TexturePlacement>;
}

/** Baker-authored active texture dependencies for one immutable renderer resource. */
export interface TextureResourceDependencies {
	/** Stable renderer resource id used to release these dependencies on eviction. */
	readonly resourceId: string;
	readonly roles: readonly TextureResourceRoleDependency[];
}

/** Placement items needed for one renderer-resource texture role. */
export interface TextureResourceRoleDependency {
	readonly purpose: TextureUsagePurpose;
	readonly itemIds: readonly string[];
}

export interface TexturePlacementIntentOptions {
	/** Caller-owned opaque clustering hint for the packer. */
	readonly affinityKey?: string | null;
}

/**
 * Structural shape of current dynamic texture-use commits. Kept local so this
 * contract module does not depend on TextureManager's implementation module.
 */
export interface DynamicTexturePlacementUse {
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureDomain: VisualTextureDomain;
	/** Material binding key that becomes the placement item id at this boundary. */
	readonly textureUseId: string;
}

export function createStaticTexturePlacementIntent(
	textureUse: StaticBakeTextureUse,
	options: TexturePlacementIntentOptions = {},
): TexturePlacementIntent {
	const pool = classifyTexturePlacementPool(textureUse.domain);
	return {
		affinityKey: options.affinityKey ?? null,
		itemId: textureUse.textureUseId,
		pool,
		purpose: classifyTextureUsagePurpose(textureUse.source, pool),
		source: createTexturePlacementMaterialSource(
			textureUse.source,
			textureUse.samplingPolicy,
		),
	};
}

export function createDynamicTexturePlacementIntent(
	textureUse: DynamicTexturePlacementUse,
	options: TexturePlacementIntentOptions = {},
): TexturePlacementIntent {
	const pool = classifyTexturePlacementPool(textureUse.textureDomain);
	return {
		affinityKey: options.affinityKey ?? null,
		itemId: textureUse.textureUseId,
		pool,
		purpose: classifyTextureUsagePurpose(textureUse.source, pool),
		source: createTexturePlacementMaterialSource(
			textureUse.source,
			textureUse.samplingPolicy,
		),
	};
}

export function classifyTexturePlacementPool(
	domain: VisualTextureDomain,
): TexturePlacementPool {
	if (domain === "outdoor-terrain") {
		return "terrain";
	}
	if (domain === "runtime-object-material") {
		return "runtime-authored-object";
	}
	return "static-authored-object";
}

export function classifyTextureUsagePurpose(
	source: MaterialTextureDataUseIdentity,
	pool: TexturePlacementPool,
): TextureUsagePurpose {
	if (pool === "terrain") {
		return classifyTerrainTextureUsagePurpose(source);
	}
	return classifyObjectTextureUsagePurpose(source);
}

function classifyTerrainTextureUsagePurpose(
	source: MaterialTextureDataUseIdentity,
): TextureUsagePurpose {
	if (source.kind === "palette-texture-use") {
		return "terrain-color";
	}
	if (source.usage === "rgba-mask") {
		return "terrain-mask";
	}
	if (source.usage === "rgba-detail") {
		return "terrain-detail";
	}
	return "terrain-color";
}

function classifyObjectTextureUsagePurpose(
	source: MaterialTextureDataUseIdentity,
): TextureUsagePurpose {
	if (source.kind === "palette-texture-use") {
		return "object-palette";
	}
	if (source.usage === "index8" || source.usage === "index16") {
		return "object-index";
	}
	if (source.usage === "rgba-detail") {
		return "object-detail";
	}
	return "object-base-color";
}

function createTexturePlacementMaterialSource(
	dataUse: MaterialTextureDataUseIdentity,
	samplingPolicy: StaticBakeTextureSamplingPolicy | undefined,
): TexturePlacementMaterialSource {
	if (!samplingPolicy) {
		return { dataUse, kind: "material-texture-data-use" };
	}
	return { dataUse, kind: "material-texture-data-use", samplingPolicy };
}
