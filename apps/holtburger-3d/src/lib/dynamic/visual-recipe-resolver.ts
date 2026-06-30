import type {
	DynamicEntityRecipe,
	DynamicEntityRecipeSource,
	DynamicEntityAnimationSelection,
	DynamicEntityAppearanceOverride,
	DynamicVisualMaterialPolicy,
	DynamicEntityTransformState,
	DynamicEntityAnimationResource,
} from "./contracts";
import type { PreparedAsset, PreparedAssetReader } from "../assets/contracts";
import { createHostAssetKey, formatHostAssetId } from "../assets/keys";
import {
	animationPayloadDtoSchema,
	setupModelPayloadDtoSchema,
} from "../host/contracts";
import { resolveStaticObjectSourceClosure } from "../static/objects/static-object-source-closure";

export interface DynamicVisualRecipeResolutionRequest {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly assetReader: PreparedAssetReader;
	readonly baseTransform: DynamicEntityTransformState;
	readonly entityId: string;
	readonly materialPolicy: DynamicVisualMaterialPolicy;
	readonly modelData: DynamicEntityAppearanceOverride | null;
	readonly setupModelId: number;
	readonly source: DynamicEntityRecipeSource;
}

export interface DynamicVisualRecipeResolver {
	resolveRecipe(
		request: DynamicVisualRecipeResolutionRequest,
	): Promise<DynamicEntityRecipe>;
}

export async function resolveDynamicVisualRecipe(
	request: DynamicVisualRecipeResolutionRequest,
): Promise<DynamicEntityRecipe> {
	const setupModelKey = createHostAssetKey("setup-model", request.setupModelId);
	const setupModelAsset =
		await request.assetReader.requestPreparedAsset(setupModelKey);
	const setupModel = setupModelPayloadDtoSchema.safeParse(
		setupModelAsset.payload,
	);
	if (!setupModel.success) {
		throw new Error(
			`Prepared setup-model asset ${setupModelAsset.sourceAssetId} did not contain setup-model payload.`,
		);
	}

	const animation = await resolveRecipeAnimation({
		animationSelection: request.animationSelection,
		assetReader: request.assetReader,
		defaultAnimationId: setupModel.data.defaultAnimation,
	});
	const setupAppearanceHostKey = createSetupAppearanceOverrideHostKey(
		request.setupModelId,
		request.modelData,
	);
	const closure = await resolveStaticObjectSourceClosure({
		assetService: request.assetReader,
		setupAppearanceHostKeys:
			setupAppearanceHostKey === null
				? undefined
				: new Map([[request.setupModelId, setupAppearanceHostKey]]),
		sourceAssetIds: [formatHostAssetId(setupModelKey)],
	});
	const resolvedSetupModel = closure.sourceAssets.find(
		(source) =>
			source.identity.sourceAssetKind === "setup-model" &&
			source.identity.sourceDid === request.setupModelId,
	);
	if (!resolvedSetupModel) {
		throw new Error(
			`Dynamic visual recipe ${request.entityId} did not resolve setup-model ${setupModelKey.id}.`,
		);
	}

	return {
		animationSelection: request.animationSelection,
		baseTransform: request.baseTransform,
		entityId: request.entityId,
		source: request.source,
		visual: {
			animation,
			materialPolicy: request.materialPolicy,
			materialSources: closure.materialSources,
			missingRefs: closure.missingRefs.filter(
				(ref) => !isOptionalSetupAppearanceRef(ref),
			),
			paletteSources: closure.paletteSources,
			setupModel: resolvedSetupModel,
			sourceAssets: closure.sourceAssets,
			textureRefs: closure.textureRefs,
		},
	};
}

async function resolveRecipeAnimation(options: {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly assetReader: PreparedAssetReader;
	readonly defaultAnimationId: number | null;
}): Promise<DynamicEntityAnimationResource | null> {
	if (options.animationSelection.kind === "none") {
		return null;
	}
	const animationId =
		options.animationSelection.kind === "explicit"
			? options.animationSelection.animationId
			: options.defaultAnimationId;
	if (animationId === null) {
		return null;
	}
	const animationKey = createHostAssetKey("animation", animationId);
	const animationAsset =
		await options.assetReader.requestPreparedAsset(animationKey);
	return createAnimationResource(animationAsset);
}

function createAnimationResource(
	asset: PreparedAsset,
): DynamicEntityAnimationResource {
	const animationPayload = animationPayloadDtoSchema.safeParse(asset.payload);
	if (!animationPayload.success) {
		throw new Error(
			`Prepared animation asset ${asset.sourceAssetId} did not contain animation payload.`,
		);
	}
	if (animationPayload.data.frameCount === 0) {
		throw new Error(
			`Prepared animation asset ${asset.sourceAssetId} has no frames to sample.`,
		);
	}
	return {
		assetId: asset.sourceAssetId,
		payload: animationPayload.data,
	};
}

function createSetupAppearanceOverrideHostKey(
	setupModelId: number,
	modelData: DynamicEntityAppearanceOverride | null,
): ReturnType<typeof createHostAssetKey> | null {
	if (modelData === null || !hasRuntimeAppearanceOverrides(modelData)) {
		return null;
	}
	return createHostAssetKey(
		"setup-appearance",
		`${formatHex32(setupModelId)}${createSetupAppearanceOverrideQuery(modelData)}`,
	);
}

function hasRuntimeAppearanceOverrides(
	modelData: DynamicEntityAppearanceOverride,
): boolean {
	return (
		modelData.paletteId !== null ||
		modelData.subPalettes.length > 0 ||
		modelData.textureChanges.length > 0 ||
		modelData.animPartChanges.length > 0
	);
}

function createSetupAppearanceOverrideQuery(
	modelData: DynamicEntityAppearanceOverride,
): string {
	const params: string[] = [];
	if (modelData.paletteId !== null) {
		params.push(`palette=${formatHex32(modelData.paletteId)}`);
	}
	const subPalettes = [...modelData.subPalettes].sort(
		(left, right) =>
			left.offset - right.offset ||
			left.numColors - right.numColors ||
			left.subId - right.subId,
	);
	if (subPalettes.length > 0) {
		params.push(
			`sub=${subPalettes
				.map(
					(subPalette) =>
						`${subPalette.offset}:${subPalette.numColors}:${formatHex32(subPalette.subId)}`,
				)
				.join(",")}`,
		);
	}
	const textureChanges = [...modelData.textureChanges].sort(
		(left, right) =>
			left.partIndex - right.partIndex ||
			left.oldTexture - right.oldTexture ||
			left.newTexture - right.newTexture,
	);
	if (textureChanges.length > 0) {
		params.push(
			`tex=${textureChanges
				.map(
					(change) =>
						`${change.partIndex}:${formatHex32(change.oldTexture)}:${formatHex32(change.newTexture)}`,
				)
				.join(",")}`,
		);
	}
	const animPartChanges = [...modelData.animPartChanges].sort(
		(left, right) =>
			left.partIndex - right.partIndex || left.partId - right.partId,
	);
	if (animPartChanges.length > 0) {
		params.push(
			`part=${animPartChanges
				.map((change) => `${change.partIndex}:${formatHex32(change.partId)}`)
				.join(",")}`,
		);
	}
	return params.length === 0 ? "" : `?${params.join("&")}`;
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function isOptionalSetupAppearanceRef(
	ref: DynamicEntityRecipe["visual"]["missingRefs"][number],
): boolean {
	return (
		ref.kind === "static-object-source" &&
		ref.sourceAssetKind === "setup-appearance"
	);
}
