import type { PreparedAssetReader } from "../../../assets/contracts";
import type { StaticBakeJobPayload, StaticScopePayload } from "../../contracts";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import type { ObjectVisualTexturePlacementIntent } from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { createMaterialTextureIdentityFacts } from "../../../textures/material-texture-identity";
import { createObjectVisualSourcePayload } from "./object-visual-source-payload";
import { partitionStaticObjectBatches } from "./static-object-batch-partitioner";
import { isCurrentlyStageableStaticObjectDataUse } from "./static-object-renderability";

export async function createStaticObjectTexturePlacementIntents(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
}): Promise<readonly ObjectVisualTexturePlacementIntent[]> {
	const requirementsByBindingId = new Map<
		string,
		ObjectVisualTexturePlacementRequirement
	>();

	for (const item of input.items) {
		if (!hasStaticObjectTexturePlanningPayload(item.payload)) {
			continue;
		}
		const payload = createObjectVisualSourcePayload(item);
		const partitionPlan = partitionStaticObjectBatches(payload);
		for (const partition of partitionPlan.partitions) {
			for (const entry of partition.coarseTablePlan.entries) {
				for (const dataUse of entry.textureDataUses) {
					if (!isCurrentlyStageableStaticObjectDataUse(dataUse)) {
						continue;
					}
					const requirement = createStaticMaterialTextureBindingRequirement({
						dataUse,
						domain: item.task.domain,
						textureUseNamespace: "static-object-texture",
						textureUseScopeId: item.task.ownerId,
						wrapMode: entry.textureWrapMode,
					});
					if (requirementsByBindingId.has(requirement.bindingId)) {
						continue;
					}
					const identity = await createMaterialTextureIdentityFacts({
						assetReader: input.assetReader,
						dataUse,
						domain: item.task.domain,
						purpose: requirement.purpose,
						samplingPolicy: requirement.samplingPolicy,
					});
					requirementsByBindingId.set(requirement.bindingId, {
						policy: {
							affinityKey: createStaticObjectPlacementAffinityKey({
								landblockId: payload.landblock.landblockId,
								ownerId: item.task.ownerId,
								partitionBatchKey: partition.batchKey,
							}),
							domain: payload.domain,
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
