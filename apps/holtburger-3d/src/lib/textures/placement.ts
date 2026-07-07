import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureSamplingPolicy,
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import type {
	TextureBindingId,
	TextureKey,
	TextureOwnerId,
	TexturePageClass,
} from "./identity";

/** Shader/page purpose used to group compatible placement items before baking. */
export type TextureUsagePurpose =
	| "object-base-color"
	| "object-detail"
	| "object-index"
	| "object-palette"
	| "terrain-color"
	| "terrain-detail"
	| "terrain-mask";

/** Opaque atlas allocation namespace for compatible placement reuse. */
export type TexturePlacementBucketKey = string & {
	readonly __texturePlacementBucketKey: unique symbol;
};

/** Bundle-local numeric lookup id for object-visual placement during baking. */
export type TexturePlacementItemId = number & {
	readonly __texturePlacementItemId: unique symbol;
};

/** Placement lookup key supported by the current terrain and object-visual paths. */
export type TexturePlacementLookupId = string | TexturePlacementItemId;

/** Lifetime/churn policy that decides how broadly placement may be shared. */
type TexturePlacementBucketLifetime =
	| {
			/** Static-authored resources can share across source-ready bake closures. */
			readonly kind: "static-authored";
	  }
	| {
			/** Static-authored dynamic textures are retained with their static owner. */
			readonly kind: "static-authored-dynamic";
			readonly ownerId: string;
	  }
	| {
			/** Runtime-authored dynamic textures are isolated to runtime lifetime. */
			readonly kind: "runtime-authored-dynamic";
			readonly entityId: string;
	  };

export interface TexturePlacementBucketInput {
	/** Renderer texture domain that owns the compatible atlas registry. */
	readonly domain: VisualTextureDomain;
	/** Shader/page purpose that must remain compatible inside the bucket. */
	readonly purpose: TextureUsagePurpose;
	/** Allocation lifetime and reuse policy for this bucket. */
	readonly lifetime: TexturePlacementBucketLifetime;
}

/**
 * Current prepared/material texture source carried losslessly through the
 * placement bridge. Placement identity is carried separately as `itemId`.
 */
interface TexturePlacementMaterialSource {
	readonly kind: "material-texture-data-use";
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
}

/** Source bytes or prepared texture identity for one placement item. */
export type TexturePlacementSource = TexturePlacementMaterialSource;

/** Texture binding need shared by placement planning, bakers, and dependency emission. */
export interface TextureBindingRequirement<
	TPlacementItemId extends TexturePlacementLookupId = string,
> {
	/** Material-consumer binding identity. This is not canonical texture-pool identity. */
	readonly bindingId: TextureBindingId;
	/** Packer/placement snapshot key used by bake-time material partition lookup. */
	readonly placementItemId: TPlacementItemId;
	/** Source dedupe key, including palette/subpalette identity where applicable. */
	readonly sourceKey: string;
	/** Shader/page purpose for the placement item. */
	readonly purpose: TextureUsagePurpose;
	/** Prepared/material source facts needed to build atlas pixels. */
	readonly source: TexturePlacementSource;
	/** Sampling policy carried by the current material texture bridge, if any. */
	readonly samplingPolicy: StaticBakeTextureSamplingPolicy | undefined;
}

/** CPU-side request to assign one opaque texture item to an atlas page. */
export interface TexturePlacementIntent<
	TPlacementItemId extends TexturePlacementLookupId = string,
> {
	/** Material-consumer binding identity that requested this placement. */
	readonly bindingId: TextureBindingId;
	/** Canonical texture-pool identity requested by this placement. */
	readonly textureKey: TextureKey;
	/** Residency owners that keep this texture alive. */
	readonly ownerIds: readonly TextureOwnerId[];
	/** Physical atlas-page compatibility class for this placement. */
	readonly pageClass: TexturePageClass;
	/** Opaque placement item id used by the packer and baker placement snapshot. */
	readonly itemId: TPlacementItemId;
	/** Atlas allocation namespace where compatible sources can be reused. */
	readonly placementBucketKey: TexturePlacementBucketKey;
	/** Exact renderer texture domain that must own the atlas registry entry. */
	readonly domain: VisualTextureDomain;
	/** Page compatibility and shader role for the item. */
	readonly purpose: TextureUsagePurpose;
	/** Opaque packer clustering hint owned by the caller. */
	readonly affinityKey: string | null;
	/** Prepared/material source facts needed to build atlas pixels. */
	readonly source: TexturePlacementSource;
}

/** CPU-side physical atlas assignment for one placement item. */
export interface TexturePlacement<
	TPlacementItemId extends TexturePlacementLookupId = string,
> {
	readonly textureKey: TextureKey;
	readonly ownerIds: readonly TextureOwnerId[];
	readonly pageClass: TexturePageClass;
	readonly itemId: TPlacementItemId;
	readonly purpose: TextureUsagePurpose;
	/** Renderer texture page identity used for shader binding legality. */
	readonly textureRefId: string;
	/** Packer-local page id retained for diagnostics. Not globally unique. */
	readonly pageId: string;
	readonly rect: readonly [number, number, number, number];
	readonly width: number;
	readonly height: number;
}

/** Material-consumer binding resolved to a physical atlas placement. */
interface TextureBindingPlacement<
	TPlacementItemId extends TexturePlacementLookupId = string,
> {
	/** Material-consumer binding identity. This is not physical atlas identity. */
	readonly bindingId: TextureBindingId;
	/** Physical atlas placement shared by every binding with the same texture key/page class. */
	readonly placement: TexturePlacement<TPlacementItemId>;
}

/** Compact baker input keyed by placement item id. */
export interface TexturePlacementSnapshot<
	TPlacementItemId extends TexturePlacementLookupId = string,
> {
	readonly placementsByItemId: ReadonlyMap<
		TPlacementItemId,
		TexturePlacement<TPlacementItemId>
	>;
}

/** Object-visual placement snapshot keyed by numeric bake-time item ids. */
export interface ObjectVisualTexturePlacementSnapshot extends TexturePlacementSnapshot<TexturePlacementItemId> {
	/** Boundary bridge from renderer/runtime binding ids to numeric bake ids. */
	readonly itemIdsByBindingId: ReadonlyMap<
		TextureBindingId,
		TexturePlacementItemId
	>;
	/** Placement facts keyed by stable material binding id; avoids numeric bake-id collisions across batches. */
	readonly placementsByBindingId: ReadonlyMap<
		TextureBindingId,
		TextureBindingPlacement<TexturePlacementItemId>
	>;
}

export function isObjectVisualTexturePlacementSnapshot(
	snapshot: TexturePlacementSnapshot | ObjectVisualTexturePlacementSnapshot,
): snapshot is ObjectVisualTexturePlacementSnapshot {
	return "itemIdsByBindingId" in snapshot;
}

export function requireObjectVisualTexturePlacementSnapshot(
	snapshot:
		| TexturePlacementSnapshot
		| ObjectVisualTexturePlacementSnapshot
		| undefined,
	subject: string,
): ObjectVisualTexturePlacementSnapshot {
	if (!snapshot || !isObjectVisualTexturePlacementSnapshot(snapshot)) {
		throw new Error(
			`${subject} requires an object-visual texture placement snapshot.`,
		);
	}
	return snapshot;
}

/** Object-visual texture binding need with numeric bake lookup identity. */
export type ObjectVisualTextureBindingRequirement =
	TextureBindingRequirement<TexturePlacementItemId>;

/** Object-visual placement intent with numeric bake lookup identity. */
export type ObjectVisualTexturePlacementIntent =
	TexturePlacementIntent<TexturePlacementItemId>;

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
	/** Material-consumer binding identity that requested this placement. */
	readonly bindingId?: TextureBindingId;
	/** Canonical texture-pool identity requested by this placement. */
	readonly textureKey?: TextureKey;
	/** Residency owners that keep this texture alive. */
	readonly ownerIds?: readonly TextureOwnerId[];
	/** Physical atlas-page compatibility class for this placement. */
	readonly pageClass?: TexturePageClass;
	/** Caller-owned opaque clustering hint for the packer. */
	readonly affinityKey?: string | null;
	/** Explicit dynamic placement bucket when caller owns runtime/static lifetime. */
	readonly placementBucketKey?: TexturePlacementBucketKey;
}

export function createTexturePlacementItemId(
	value: number,
): TexturePlacementItemId {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`Texture placement item id must be a safe non-negative integer: ${value}.`,
		);
	}
	return value as TexturePlacementItemId;
}

/** Structural shape of current dynamic texture commits. */
export interface DynamicTexturePlacementUse {
	readonly bindingId: TextureBindingId;
	readonly ownerIds: readonly TextureOwnerId[];
	readonly pageClass: TexturePageClass;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureKey: TextureKey;
	readonly textureDomain: VisualTextureDomain;
}

export function createStaticTexturePlacementIntent(
	textureUse: StaticBakeTextureUse,
	options: TexturePlacementIntentOptions = {},
): TexturePlacementIntent {
	const purpose = classifyTextureUsagePurpose(
		textureUse.source,
		textureUse.domain,
	);
	const identity = requireTexturePlacementIdentity({
		bindingId: options.bindingId ?? textureUse.bindingId,
		ownerIds: options.ownerIds ?? textureUse.ownerIds,
		pageClass: options.pageClass ?? textureUse.pageClass,
		textureKey: options.textureKey ?? textureUse.textureKey,
	});
	return {
		affinityKey: options.affinityKey ?? null,
		bindingId: identity.bindingId,
		domain: textureUse.domain,
		itemId: textureUse.bindingId,
		ownerIds: identity.ownerIds,
		pageClass: identity.pageClass,
		textureKey: identity.textureKey,
		placementBucketKey:
			options.placementBucketKey ??
			createTexturePlacementBucketKey({
				domain: textureUse.domain,
				lifetime: { kind: "static-authored" },
				purpose,
			}),
		purpose,
		source: createTexturePlacementMaterialSource(
			textureUse.source,
			textureUse.samplingPolicy,
		),
	};
}

export function createObjectVisualStaticTexturePlacementIntent(
	textureUse: StaticBakeTextureUse,
	itemId: TexturePlacementItemId,
	options: TexturePlacementIntentOptions = {},
): ObjectVisualTexturePlacementIntent {
	const intent = createStaticTexturePlacementIntent(textureUse, options);
	return {
		...intent,
		itemId,
	};
}

export function createDynamicTexturePlacementIntent(
	textureUse: DynamicTexturePlacementUse,
	options: TexturePlacementIntentOptions = {},
): TexturePlacementIntent {
	const purpose = classifyTextureUsagePurpose(
		textureUse.source,
		textureUse.textureDomain,
	);
	if (!options.placementBucketKey) {
		throw new Error(
			"Dynamic texture placement intents require an explicit placement bucket key.",
		);
	}
	const identity = requireTexturePlacementIdentity({
		bindingId: options.bindingId ?? textureUse.bindingId,
		ownerIds: options.ownerIds ?? textureUse.ownerIds,
		pageClass: options.pageClass ?? textureUse.pageClass,
		textureKey: options.textureKey ?? textureUse.textureKey,
	});
	return {
		affinityKey: options.affinityKey ?? null,
		bindingId: identity.bindingId,
		domain: textureUse.textureDomain,
		itemId: identity.bindingId,
		ownerIds: identity.ownerIds,
		pageClass: identity.pageClass,
		textureKey: identity.textureKey,
		placementBucketKey: options.placementBucketKey,
		purpose,
		source: createTexturePlacementMaterialSource(
			textureUse.source,
			textureUse.samplingPolicy,
		),
	};
}

function requireTexturePlacementIdentity(
	options: TexturePlacementIntentOptions,
): Required<
	Pick<
		TexturePlacementIntentOptions,
		"bindingId" | "textureKey" | "ownerIds" | "pageClass"
	>
> {
	if (!options.bindingId) {
		throw new Error("Texture placement intents require a bindingId.");
	}
	if (!options.textureKey) {
		throw new Error("Texture placement intents require a textureKey.");
	}
	if (!options.ownerIds) {
		throw new Error("Texture placement intents require ownerIds.");
	}
	if (!options.pageClass) {
		throw new Error("Texture placement intents require a pageClass.");
	}
	return {
		bindingId: options.bindingId,
		ownerIds: options.ownerIds,
		pageClass: options.pageClass,
		textureKey: options.textureKey,
	};
}

export function createObjectVisualDynamicTexturePlacementIntent(
	textureUse: DynamicTexturePlacementUse,
	itemId: TexturePlacementItemId,
	options: TexturePlacementIntentOptions = {},
): ObjectVisualTexturePlacementIntent {
	const intent = createDynamicTexturePlacementIntent(textureUse, options);
	return {
		...intent,
		itemId,
	};
}

export function createStaticAuthoredTexturePlacementBucketKey(
	intent: TexturePlacementIntent,
): TexturePlacementBucketKey {
	return intent.placementBucketKey;
}

export function createStaticAuthoredDynamicTexturePlacementBucketKey(input: {
	readonly domain: Exclude<VisualTextureDomain, "runtime-object-material">;
	readonly ownerId: string;
	readonly purpose: TextureUsagePurpose;
}): TexturePlacementBucketKey {
	return createTexturePlacementBucketKey({
		domain: input.domain,
		lifetime: {
			kind: "static-authored-dynamic",
			ownerId: input.ownerId,
		},
		purpose: input.purpose,
	});
}

export function createRuntimeAuthoredDynamicTexturePlacementBucketKey(input: {
	readonly entityId: string;
	readonly purpose: TextureUsagePurpose;
}): TexturePlacementBucketKey {
	return createTexturePlacementBucketKey({
		domain: "runtime-object-material",
		lifetime: {
			entityId: input.entityId,
			kind: "runtime-authored-dynamic",
		},
		purpose: input.purpose,
	});
}

export function createTexturePlacementBucketKey(
	input: TexturePlacementBucketInput,
): TexturePlacementBucketKey {
	return [
		"texture-placement-bucket",
		input.domain,
		input.purpose,
		createTexturePlacementBucketLifetimeKey(input.lifetime),
	].join("|") as TexturePlacementBucketKey;
}

export function classifyTextureUsagePurpose(
	source: MaterialTextureDataUseIdentity,
	domain: VisualTextureDomain,
): TextureUsagePurpose {
	if (domain === "outdoor-terrain") {
		return classifyTerrainTextureUsagePurpose(source);
	}
	return classifyObjectTextureUsagePurpose(source);
}

function classifyTerrainTextureUsagePurpose(
	source: MaterialTextureDataUseIdentity,
): TextureUsagePurpose {
	if (source.kind === "prepared-palette-texture-use") {
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
	if (source.kind === "prepared-palette-texture-use") {
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

function createTexturePlacementBucketLifetimeKey(
	lifetime: TexturePlacementBucketLifetime,
): string {
	switch (lifetime.kind) {
		case "static-authored":
			return "static-authored";
		case "static-authored-dynamic":
			return `static-authored-dynamic:${lifetime.ownerId}`;
		case "runtime-authored-dynamic":
			return `runtime-authored-dynamic:${lifetime.entityId}`;
	}
}
