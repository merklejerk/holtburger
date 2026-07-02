import type {
	DynamicEntityRecipe,
	DynamicObjectVisualBundleExpansion,
} from "./contracts";
import type {
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceGeometryAttachment,
} from "../static/contracts";
import type { StaticObjectBatchPayload } from "../static/objects/bake/static-object-batch-partitioner";
import {
	createStaticObjectVisualBundleExpansion,
	createStaticObjectVisualRecipePlan,
} from "../static/objects/bake/static-object-visual-bundle-producer";
import {
	createObjectVisualReadyResolution,
	type ObjectVisualBundleReadyResolution,
	type ObjectVisualPartInstance,
} from "../visual/object-visual-recipe-bundle";

export function createDynamicObjectVisualBundleExpansion(input: {
	readonly recipe: DynamicEntityRecipe;
	readonly sourceGeometry: readonly StaticObjectSourceGeometryAttachment[];
}): DynamicObjectVisualBundleExpansion {
	const expansion = createStaticObjectVisualBundleExpansion({
		attachments: { staticObjectSourceGeometry: input.sourceGeometry },
		payload: createDynamicObjectVisualPayload(input.recipe),
	});
	if (expansion.resolution.kind !== "ready") {
		return expansion;
	}

	return {
		geometryBuffers: expansion.geometryBuffers,
		resolution: createObjectVisualReadyResolution({
			...expansion.resolution.bundle,
			partInstances: createDynamicPartInstances({
				readyResolution: expansion.resolution,
				recipe: input.recipe,
			}),
		}),
	};
}

export function createDynamicObjectVisualRecipePlan(
	recipe: DynamicEntityRecipe,
): ReturnType<typeof createStaticObjectVisualRecipePlan> {
	return createStaticObjectVisualRecipePlan(
		createDynamicObjectVisualPayload(recipe),
	);
}

function createDynamicObjectVisualPayload(
	recipe: DynamicEntityRecipe,
): StaticObjectBatchPayload {
	const identity = createDynamicStaticObjectIdentity(recipe);
	return {
		domain:
			recipe.source.sourceResidence.kind === "env-cell"
				? "env-cell-system"
				: "outdoor-explicit-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: recipe.source.sourceResidence.landblockId,
			source:
				recipe.source.sourceResidence.kind === "env-cell"
					? "env-cells"
					: "outdoor",
		},
		materialSlots: createDynamicMaterialSlots({
			object: identity,
			recipe,
		}),
		materialSources: recipe.visual.materialSources,
		objects: [
			{
				debug: {
					sourceAssetId: recipe.visual.setupModel.debug.sourceAssetId,
				},
				generated: null,
				identity,
				instanceBounds: recipe.visual.setupModel.bounds,
				localPlacement: recipe.baseTransform.baseLocalPlacement,
				owningEnvCellId:
					recipe.source.sourceResidence.kind === "env-cell"
						? recipe.source.sourceResidence.envCellId
						: null,
				portalCount: 0,
				source: recipe.visual.setupModel.identity,
				sourceBounds: recipe.visual.setupModel.bounds,
				sourceIndex: 0,
				sourceScale: recipe.baseTransform.sourceScale,
			},
		],
		paletteSources: recipe.visual.paletteSources,
		regionRenderProfile: { detailRoles: [] },
		sourceAssets: createDynamicObjectVisualSourceAssets(recipe),
		textureRefs: recipe.visual.textureRefs,
	};
}

export function createDynamicObjectVisualSourceAssets(
	recipe: DynamicEntityRecipe,
): readonly StaticObjectSourceAssetFacts[] {
	if (
		recipe.visual.sourceAssets.some((sourceAsset) =>
			staticObjectSourceEquals(
				sourceAsset.identity,
				recipe.visual.setupModel.identity,
			),
		)
	) {
		return recipe.visual.sourceAssets;
	}
	return [recipe.visual.setupModel, ...recipe.visual.sourceAssets];
}

function staticObjectSourceEquals(
	left: StaticObjectSourceAssetFacts["identity"],
	right: StaticObjectSourceAssetFacts["identity"],
): boolean {
	return (
		left.kind === right.kind &&
		left.sourceAssetKind === right.sourceAssetKind &&
		left.sourceDid === right.sourceDid
	);
}

function createDynamicMaterialSlots(options: {
	readonly object: StaticObjectInstanceIdentity;
	readonly recipe: DynamicEntityRecipe;
}): readonly StaticObjectMaterialSlotFacts[] {
	return options.recipe.visual.setupModel.parts.flatMap((part) =>
		part.materialSlots.map((slot): StaticObjectMaterialSlotFacts => ({
			gfxObj: part.gfxObj,
			identity: {
				geometrySurfaceId: slot.geometrySurfaceId,
				kind: "static-material-slot",
				materialSurfaceId: slot.materialSurfaceId,
				part: {
					kind: "static-object-part",
					object: options.object,
					partIndex: part.partIndex,
				},
				slotIndex: slot.slotIndex,
			},
			material: slot.material,
			materialVariantSignature: slot.materialVariantSignature,
			object: options.object,
			paletteOverride: slot.paletteOverride,
			paletteViews: slot.paletteViews,
			source: part.source,
		})),
	);
}

function createDynamicPartInstances(input: {
	readonly readyResolution: ObjectVisualBundleReadyResolution;
	readonly recipe: DynamicEntityRecipe;
}): readonly ObjectVisualPartInstance[] {
	return input.readyResolution.bundle.partInstances.map((instance, index) => {
		const part = input.recipe.visual.setupModel.parts[index];
		return {
			...instance,
			residency:
				input.recipe.source.kind === "runtime-authored"
					? {
							kind: "runtime-entity",
							runtimeEntityId: input.recipe.source.runtimeEntityId,
						}
					: instance.residency,
			sourcePartIndex: part?.partIndex ?? null,
		};
	});
}

function createDynamicStaticObjectIdentity(
	recipe: DynamicEntityRecipe,
): StaticObjectInstanceIdentity {
	return {
		instanceId: recipe.entityId,
		kind: "static-object-instance",
		landblockId: recipe.source.sourceResidence.landblockId,
		objectKind: "explicit-object",
	};
}
