import type { StaticBakeBatchItem, StaticScopePayload } from "../../contracts";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import type { ObjectVisualTexturePlacementIntent } from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { createStaticObjectBatchPayload } from "./static-object-batch-payload";
import { partitionStaticObjectBatches } from "./static-object-batch-partitioner";
import { isCurrentlyStageableStaticObjectDataUse } from "./static-object-renderability";

export function createStaticObjectTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeBatchItem[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const requirementsByTextureUseId = new Map<
		string,
		ObjectVisualTexturePlacementRequirement
	>();

	for (const item of input.items) {
		if (!hasStaticObjectTexturePlanningPayload(item.payload)) {
			continue;
		}
		const payload = createStaticObjectBatchPayload(item);
		const partitionPlan = partitionStaticObjectBatches(payload);
		for (const partition of partitionPlan.partitions) {
			for (const entry of partition.coarseTablePlan.entries) {
				for (const dataUse of entry.textureDataUses) {
					if (!isCurrentlyStageableStaticObjectDataUse(dataUse)) {
						continue;
					}
					const requirement = createStaticMaterialTextureBindingRequirement({
						dataUse,
						textureUseNamespace: "static-object-texture",
						textureUseScopeId: item.task.ownerId,
						wrapMode: entry.textureWrapMode,
					});
					if (requirementsByTextureUseId.has(requirement.textureUseId)) {
						continue;
					}
					requirementsByTextureUseId.set(requirement.textureUseId, {
						policy: {
							affinityKey: createStaticObjectPlacementAffinityKey({
								landblockId: payload.landblock.landblockId,
								ownerId: item.task.ownerId,
								partitionBatchKey: partition.batchKey,
							}),
							domain: payload.domain,
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

function hasStaticObjectTexturePlanningPayload(
	payload: StaticScopePayload,
): boolean {
	if (payload.scope.kind === "env-cell-system") {
		return (payload.scope.sourceAssets ?? []).some((source) =>
			source.parts.some((part) => part.triangles.length > 0),
		);
	}
	if (payload.scope.kind !== "outdoor-static-objects") {
		return false;
	}
	return payload.scope.sourceAssets.some((source) =>
		source.parts.some((part) => part.triangles.length > 0),
	);
}

function createStaticObjectPlacementAffinityKey(input: {
	readonly landblockId: number;
	readonly ownerId: string;
	readonly partitionBatchKey: string;
}): string {
	return [
		"static-object",
		`landblock:${formatHex32(input.landblockId)}`,
		`owner:${input.ownerId}`,
		`batch:${input.partitionBatchKey}`,
	].join("|");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
