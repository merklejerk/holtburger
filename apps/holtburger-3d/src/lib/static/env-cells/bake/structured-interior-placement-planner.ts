import type {
	StaticBakeBatchItem,
	StaticBakeTextureUse,
	StaticTextureUseOwner,
} from "../../contracts";
import type {
	ObjectVisualTexturePlacementIntent,
	TextureBindingRequirement,
} from "../../../textures/placement";
import {
	createObjectVisualStaticTexturePlacementIntent,
	createTexturePlacementItemId,
} from "../../../textures/placement";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";
import {
	createStructuredInteriorTextureBindingRequirement,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";
import { isRenderableStaticMaterialPlan } from "../../objects/bake/static-object-renderability";

export function createStructuredInteriorTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeBatchItem[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const intentsByTextureUseId = new Map<
		string,
		ObjectVisualTexturePlacementIntent
	>();

	for (const item of input.items) {
		if (
			item.task.domain !== "env-cell-system" ||
			item.payload.scope.kind !== "env-cell-system"
		) {
			continue;
		}

		for (const envCell of item.payload.scope.envCells) {
			const materialPlan = planStructuredInteriorCellMaterials({
				envCell,
				payload: item.payload.scope,
				task: item.task,
			});
			for (const [surfaceId, plan] of materialPlan.materialPlansBySurfaceId) {
				if (!isRenderableStaticMaterialPlan(plan)) {
					continue;
				}
				const wrapMode = resolveStructuredInteriorPlanTextureWrapMode(plan);
				for (const role of plan.textureRoles) {
					if (!isCurrentlyStageableStaticObjectDataUse(role.dataUse)) {
						continue;
					}
					const requirement = createStructuredInteriorTextureBindingRequirement(
						{
							dataUse: role.dataUse,
							task: item.task,
							wrapMode,
						},
					);
					if (intentsByTextureUseId.has(requirement.textureUseId)) {
						continue;
					}
					intentsByTextureUseId.set(
						requirement.textureUseId,
						createObjectVisualStaticTexturePlacementIntent(
							createStructuredInteriorPlanningTextureUse({
								requirement,
							}),
							createTexturePlacementItemId(intentsByTextureUseId.size),
							{
								affinityKey: createStructuredInteriorAffinityKey({
									envCellId: envCell.identity.envCellId,
									landblockId: item.task.scope.landblockId,
									ownerId: item.task.ownerId,
									surfaceId,
								}),
							},
						),
					);
				}
			}
		}
	}

	return [...intentsByTextureUseId.values()].sort(
		(left, right) => left.itemId - right.itemId,
	);
}

function createStructuredInteriorPlanningTextureUse(options: {
	readonly requirement: TextureBindingRequirement;
}): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		domain: "env-cell-system",
		owners: NO_STATIC_TEXTURE_USE_OWNERS,
		source: options.requirement.source.dataUse,
		textureUseId: options.requirement.bindingKey,
	};
	if (!options.requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: options.requirement.samplingPolicy,
	};
}

function createStructuredInteriorAffinityKey(input: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly ownerId: string;
	readonly surfaceId: number;
}): string {
	return [
		"structured-interior",
		`landblock:${formatHex32(input.landblockId)}`,
		`owner:${input.ownerId}`,
		`env-cell:${formatHex32(input.envCellId)}`,
		`surface:${formatHex32(input.surfaceId)}`,
	].join("|");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

const NO_STATIC_TEXTURE_USE_OWNERS: readonly StaticTextureUseOwner[] = [];
