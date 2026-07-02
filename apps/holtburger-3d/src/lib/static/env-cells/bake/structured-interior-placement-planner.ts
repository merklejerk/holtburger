import type { StaticBakeJobPayload } from "../../contracts";
import type { ObjectVisualTexturePlacementIntent } from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";
import {
	createStructuredInteriorTextureBindingRequirement,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";
import { isRenderableObjectVisualMaterialPlan } from "../../objects/bake/static-object-renderability";

export function createStructuredInteriorTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeJobPayload[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const requirementsByTextureUseId = new Map<
		string,
		ObjectVisualTexturePlacementRequirement
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
				if (!isRenderableObjectVisualMaterialPlan(plan)) {
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
					if (requirementsByTextureUseId.has(requirement.textureUseId)) {
						continue;
					}
					requirementsByTextureUseId.set(requirement.textureUseId, {
						policy: {
							affinityKey: createStructuredInteriorAffinityKey({
								envCellId: envCell.identity.envCellId,
								landblockId: item.task.scope.landblockId,
								ownerId: item.task.ownerId,
								surfaceId,
							}),
							domain: "env-cell-system",
							kind: "static-authored",
						},
						requirement,
					});
				}
			}
		}
	}

	return createObjectVisualTexturePlacementIntents({
		requirements: [...requirementsByTextureUseId.values()],
	});
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
