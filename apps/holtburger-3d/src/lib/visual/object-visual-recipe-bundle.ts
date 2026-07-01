type Brand<TValue, TBrand extends string> = TValue & {
	readonly __brand: TBrand;
};

export type ObjectVisualTextureRecipeId = Brand<
	number,
	"ObjectVisualTextureRecipeId"
>;
export type ObjectVisualMaterialRecipeId = Brand<
	number,
	"ObjectVisualMaterialRecipeId"
>;
export type ObjectVisualGeometryRecipeId = Brand<
	number,
	"ObjectVisualGeometryRecipeId"
>;
export type ObjectVisualGeometryBufferId = Brand<
	number,
	"ObjectVisualGeometryBufferId"
>;
export type ObjectVisualPartRecipeId = Brand<
	number,
	"ObjectVisualPartRecipeId"
>;

export type ObjectVisualTextureRecipeKey = Brand<
	string,
	"ObjectVisualTextureRecipeKey"
>;
export type ObjectVisualMaterialRecipeKey = Brand<
	string,
	"ObjectVisualMaterialRecipeKey"
>;
export type ObjectVisualGeometryRecipeKey = Brand<
	string,
	"ObjectVisualGeometryRecipeKey"
>;
export type ObjectVisualGeometryBufferKey = Brand<
	string,
	"ObjectVisualGeometryBufferKey"
>;
export type ObjectVisualPartRecipeKey = Brand<
	string,
	"ObjectVisualPartRecipeKey"
>;

export type ObjectVisualSourceKind = "gfx-obj" | "embedded-geometry";

export type ObjectVisualTextureUsage =
	| "object-base-color"
	| "object-detail"
	| "object-index"
	| "object-palette";

export type ObjectVisualMaterialFamily =
	| "direct-color"
	| "indexed-color"
	| "texture-rgba"
	| "unsupported";

export type ObjectVisualMaterialPass =
	| "additive"
	| "alpha-test"
	| "opaque"
	| "transparent";

/** Metadata-only texture need authored by resolvers before placement or packing. */
export interface ObjectVisualTextureRecipe {
	readonly usage: ObjectVisualTextureUsage;
	readonly source: ObjectVisualTextureSource;
}

export type ObjectVisualTextureSource =
	| ObjectVisualPaletteTextureSource
	| ObjectVisualRenderSurfaceTextureSource;

export interface ObjectVisualRenderSurfaceTextureSource {
	readonly kind: "render-surface";
	readonly renderSurfaceId: number;
	readonly surfaceTextureId: number | null;
}

export interface ObjectVisualPaletteTextureSource {
	readonly firstIndex: number;
	readonly indexCount: number;
	readonly kind: "palette";
	readonly paletteId: number;
}

export type ObjectVisualMaterialRecipe =
	| ObjectVisualDirectColorMaterialRecipe
	| ObjectVisualIndexedColorMaterialRecipe
	| ObjectVisualTextureRgbaMaterialRecipe
	| ObjectVisualUnsupportedMaterialRecipe;

export interface ObjectVisualMaterialRecipeBase {
	readonly family: ObjectVisualMaterialFamily;
	readonly pass: ObjectVisualMaterialPass;
}

export interface ObjectVisualDirectColorMaterialRecipe extends ObjectVisualMaterialRecipeBase {
	readonly diffuseColor: readonly [number, number, number, number];
	readonly family: "direct-color";
}

export interface ObjectVisualIndexedColorMaterialRecipe extends ObjectVisualMaterialRecipeBase {
	readonly colorTextureRecipeId: ObjectVisualTextureRecipeId;
	readonly family: "indexed-color";
	readonly paletteTextureRecipeId: ObjectVisualTextureRecipeId;
}

export interface ObjectVisualTextureRgbaMaterialRecipe extends ObjectVisualMaterialRecipeBase {
	readonly detailTextureRecipeId: ObjectVisualTextureRecipeId | null;
	readonly family: "texture-rgba";
	readonly rgbaTextureRecipeId: ObjectVisualTextureRecipeId;
}

export interface ObjectVisualUnsupportedMaterialRecipe extends ObjectVisualMaterialRecipeBase {
	readonly family: "unsupported";
	readonly reason: string;
}

/** Source-local geometry recipe. The baker applies `PartInstance.transform`. */
export type ObjectVisualGeometryRecipe =
	| ObjectVisualEmbeddedGeometryRecipe
	| ObjectVisualGfxObjGeometryRecipe;

export interface ObjectVisualGfxObjGeometryRecipe {
	readonly kind: "gfx-obj";
	readonly sourceDid: number;
}

export interface ObjectVisualEmbeddedGeometryRecipe {
	readonly bufferId: ObjectVisualGeometryBufferId;
	readonly kind: "embedded-geometry";
}

/** Transfer/cache reference for a heavy source-local geometry payload. */
export interface ObjectVisualGeometryBufferRef {
	readonly sourceKind: ObjectVisualSourceKind;
	readonly sourceKey: string;
	readonly vertexCount: number;
	readonly triangleCount: number;
}

/** Heavy source-local geometry payload kept outside the recipe graph body. */
export interface ObjectVisualGeometryBuffer {
	readonly bufferId: ObjectVisualGeometryBufferId;
	readonly indices: Uint32Array;
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
}

export interface ObjectVisualPartRecipe {
	readonly geometryRecipeId: ObjectVisualGeometryRecipeId;
	readonly materialBindings: readonly ObjectVisualPartMaterialBinding[];
}

/** Material binding for a source primitive subset within a part recipe. */
export interface ObjectVisualPartMaterialBinding {
	readonly geometrySurfaceId: number;
	readonly materialRecipeId: ObjectVisualMaterialRecipeId;
	readonly materialSlot: number;
	readonly polygonIds: readonly number[];
}

export type ObjectVisualResidency =
	| ObjectVisualEnvCellResidency
	| ObjectVisualOutdoorLandblockResidency
	| ObjectVisualRuntimeEntityResidency;

export interface ObjectVisualOutdoorLandblockResidency {
	readonly kind: "outdoor-landblock";
	readonly landblockId: number;
}

export interface ObjectVisualEnvCellResidency {
	readonly envCellId: number;
	readonly kind: "env-cell";
	readonly landblockId: number;
}

export interface ObjectVisualRuntimeEntityResidency {
	readonly kind: "runtime-entity";
	readonly runtimeEntityId: string;
}

export type ObjectVisualMat4 = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

export interface ObjectVisualPartInstance {
	readonly instanceId: string;
	readonly partRecipeId: ObjectVisualPartRecipeId;
	readonly residency: ObjectVisualResidency;
	/** Source-local part geometry to render-local transform. */
	readonly transform: ObjectVisualMat4;
}

export interface ObjectVisualRecipeBundle {
	readonly geometryBufferRefs: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBufferRef
	>;
	readonly geometryRecipes: ReadonlyMap<
		ObjectVisualGeometryRecipeId,
		ObjectVisualGeometryRecipe
	>;
	readonly materialRecipes: ReadonlyMap<
		ObjectVisualMaterialRecipeId,
		ObjectVisualMaterialRecipe
	>;
	readonly partInstances: readonly ObjectVisualPartInstance[];
	readonly partRecipes: ReadonlyMap<
		ObjectVisualPartRecipeId,
		ObjectVisualPartRecipe
	>;
	readonly recipeKeys: ObjectVisualRecipeKeyTables;
	readonly textureRecipes: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureRecipe
	>;
}

export type ObjectVisualBundleResolution =
	| ObjectVisualBundleMissingDependenciesResolution
	| ObjectVisualBundleReadyResolution;

export interface ObjectVisualBundleReadyResolution {
	readonly bundle: ObjectVisualRecipeBundle;
	readonly kind: "ready";
}

export interface ObjectVisualBundleMissingDependenciesResolution {
	readonly kind: "missing-dependencies";
	readonly missingDependencies: readonly ObjectVisualMissingDependency[];
}

export interface ObjectVisualMissingDependency {
	readonly sourceId: string;
	readonly sourceKind: string;
}

export interface DynamicAnimationPartBinding {
	readonly renderPartIds: readonly string[];
	readonly sourcePartIndex: number;
}

export interface ObjectVisualRecipeKeyTables {
	readonly geometryBufferKeys: readonly ObjectVisualGeometryBufferKey[];
	readonly geometryRecipeKeys: readonly ObjectVisualGeometryRecipeKey[];
	readonly materialRecipeKeys: readonly ObjectVisualMaterialRecipeKey[];
	readonly partRecipeKeys: readonly ObjectVisualPartRecipeKey[];
	readonly textureRecipeKeys: readonly ObjectVisualTextureRecipeKey[];
}

export interface ObjectVisualRecipeKeyRegistry {
	readonly geometryBufferIdsByKey: ReadonlyMap<
		ObjectVisualGeometryBufferKey,
		ObjectVisualGeometryBufferId
	>;
	readonly geometryRecipeIdsByKey: ReadonlyMap<
		ObjectVisualGeometryRecipeKey,
		ObjectVisualGeometryRecipeId
	>;
	readonly materialRecipeIdsByKey: ReadonlyMap<
		ObjectVisualMaterialRecipeKey,
		ObjectVisualMaterialRecipeId
	>;
	readonly partRecipeIdsByKey: ReadonlyMap<
		ObjectVisualPartRecipeKey,
		ObjectVisualPartRecipeId
	>;
	readonly recipeKeys: ObjectVisualRecipeKeyTables;
	readonly textureRecipeIdsByKey: ReadonlyMap<
		ObjectVisualTextureRecipeKey,
		ObjectVisualTextureRecipeId
	>;
}

export interface ObjectVisualRecipeKeyInput {
	readonly geometryBufferKeys?: readonly ObjectVisualGeometryBufferKey[];
	readonly geometryRecipeKeys?: readonly ObjectVisualGeometryRecipeKey[];
	readonly materialRecipeKeys?: readonly ObjectVisualMaterialRecipeKey[];
	readonly partRecipeKeys?: readonly ObjectVisualPartRecipeKey[];
	readonly textureRecipeKeys?: readonly ObjectVisualTextureRecipeKey[];
}

export function createObjectVisualRecipeKeyRegistry(
	input: ObjectVisualRecipeKeyInput,
): ObjectVisualRecipeKeyRegistry {
	const texture = createDenseKeyIndex<
		ObjectVisualTextureRecipeKey,
		ObjectVisualTextureRecipeId
	>(input.textureRecipeKeys ?? []);
	const material = createDenseKeyIndex<
		ObjectVisualMaterialRecipeKey,
		ObjectVisualMaterialRecipeId
	>(input.materialRecipeKeys ?? []);
	const geometry = createDenseKeyIndex<
		ObjectVisualGeometryRecipeKey,
		ObjectVisualGeometryRecipeId
	>(input.geometryRecipeKeys ?? []);
	const geometryBuffer = createDenseKeyIndex<
		ObjectVisualGeometryBufferKey,
		ObjectVisualGeometryBufferId
	>(input.geometryBufferKeys ?? []);
	const part = createDenseKeyIndex<
		ObjectVisualPartRecipeKey,
		ObjectVisualPartRecipeId
	>(input.partRecipeKeys ?? []);

	return {
		geometryBufferIdsByKey: geometryBuffer.idsByKey,
		geometryRecipeIdsByKey: geometry.idsByKey,
		materialRecipeIdsByKey: material.idsByKey,
		partRecipeIdsByKey: part.idsByKey,
		recipeKeys: {
			geometryBufferKeys: geometryBuffer.keys,
			geometryRecipeKeys: geometry.keys,
			materialRecipeKeys: material.keys,
			partRecipeKeys: part.keys,
			textureRecipeKeys: texture.keys,
		},
		textureRecipeIdsByKey: texture.idsByKey,
	};
}

export function createObjectVisualMissingDependenciesResolution(
	missingDependencies: readonly ObjectVisualMissingDependency[],
): ObjectVisualBundleMissingDependenciesResolution {
	if (missingDependencies.length === 0) {
		throw new Error(
			"Object visual missing-dependencies resolution requires at least one missing dependency.",
		);
	}
	return {
		kind: "missing-dependencies",
		missingDependencies,
	};
}

export function createObjectVisualReadyResolution(
	bundle: ObjectVisualRecipeBundle,
): ObjectVisualBundleReadyResolution {
	return {
		bundle,
		kind: "ready",
	};
}

export function isRenderableObjectVisualMaterialRecipe(
	recipe: ObjectVisualMaterialRecipe,
): recipe is Exclude<
	ObjectVisualMaterialRecipe,
	ObjectVisualUnsupportedMaterialRecipe
> {
	return recipe.family !== "unsupported";
}

export function objectVisualTextureRecipeKey(
	key: string,
): ObjectVisualTextureRecipeKey {
	return createObjectVisualRecipeKey(key) as ObjectVisualTextureRecipeKey;
}

export function objectVisualMaterialRecipeKey(
	key: string,
): ObjectVisualMaterialRecipeKey {
	return createObjectVisualRecipeKey(key) as ObjectVisualMaterialRecipeKey;
}

export function objectVisualGeometryRecipeKey(
	key: string,
): ObjectVisualGeometryRecipeKey {
	return createObjectVisualRecipeKey(key) as ObjectVisualGeometryRecipeKey;
}

export function objectVisualGeometryBufferKey(
	key: string,
): ObjectVisualGeometryBufferKey {
	return createObjectVisualRecipeKey(key) as ObjectVisualGeometryBufferKey;
}

export function objectVisualPartRecipeKey(
	key: string,
): ObjectVisualPartRecipeKey {
	return createObjectVisualRecipeKey(key) as ObjectVisualPartRecipeKey;
}

function createDenseKeyIndex<TKey extends string, TId extends number>(
	keys: readonly TKey[],
): {
	readonly idsByKey: ReadonlyMap<TKey, TId>;
	readonly keys: readonly TKey[];
} {
	const sortedKeys = [...new Set(keys)].sort(compareStrings);
	return {
		idsByKey: new Map(sortedKeys.map((key, index) => [key, index as TId])),
		keys: sortedKeys,
	};
}

function createObjectVisualRecipeKey(key: string): string {
	if (key.length === 0) {
		throw new Error("Object visual recipe keys must not be empty.");
	}
	return key;
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}
