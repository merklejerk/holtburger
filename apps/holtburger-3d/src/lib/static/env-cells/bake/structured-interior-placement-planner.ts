import type {
	StaticBakeBatchItem,
	StaticBakeTextureUse,
	StaticTextureUseOwner,
} from "../../contracts";
import type {
	TextureBindingRequirement,
	TexturePlacementIntent,
} from "../../../textures/placement";
import { createStaticTexturePlacementIntent } from "../../../textures/placement";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";
import {
	createStructuredInteriorTextureBindingRequirement,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";
import { isRenderableStaticMaterialPlan } from "../../objects/bake/static-object-renderability";

export function createStructuredInteriorTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeBatchItem[];
	readonly staticBatchId: string;
}): readonly TexturePlacementIntent[] {
	const intentsByItemId = new Map<string, TexturePlacementIntent>();

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
					const requirement =
						createStructuredInteriorTextureBindingRequirement({
							dataUse: role.dataUse,
							task: item.task,
							wrapMode,
						});
					if (intentsByItemId.has(requirement.placementItemId)) {
						continue;
					}
					intentsByItemId.set(
						requirement.placementItemId,
						createStaticTexturePlacementIntent(
							createStructuredInteriorPlanningTextureUse({
								requirement,
								staticBatchId: input.staticBatchId,
							}),
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

	return [...intentsByItemId.values()].sort((left, right) =>
		left.itemId.localeCompare(right.itemId),
	);
}

function createStructuredInteriorPlanningTextureUse(options: {
	readonly requirement: TextureBindingRequirement;
	readonly staticBatchId: string;
}): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		domain: "env-cell-system",
		owners: NO_STATIC_TEXTURE_USE_OWNERS,
		source: options.requirement.source.dataUse,
		staticBatchId: options.staticBatchId,
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
