import type { PreparedAssetReader } from "../../../assets/contracts";
import type { StaticBakeJobPayload } from "../../contracts";
import type { ObjectVisualTexturePlacementIntent } from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { createMaterialTextureIdentityFacts } from "../../../textures/material-texture-identity";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";
import {
	createStructuredInteriorTextureBindingRequirement,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";
import { isRenderableObjectVisualMaterialPlan } from "../../objects/bake/static-object-renderability";

export async function createStructuredInteriorTexturePlacementIntents(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
}): Promise<readonly ObjectVisualTexturePlacementIntent[]> {
	const requirementsByBindingId = new Map<
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
					if (requirementsByBindingId.has(requirement.bindingId)) {
						continue;
					}
					const identity = await createMaterialTextureIdentityFacts({
						assetReader: input.assetReader,
						dataUse: role.dataUse,
						domain: item.task.domain,
						purpose: requirement.purpose,
						samplingPolicy: requirement.samplingPolicy,
					});
					requirementsByBindingId.set(requirement.bindingId, {
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
						requirement: {
							...requirement,
							ownerIds: [],
							pageClass: identity.pageClass,
							textureKey: identity.textureKey,
						},
					});
				}
			}
		}
	}

	return createObjectVisualTexturePlacementIntents({
		requirements: [...requirementsByBindingId.values()],
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
