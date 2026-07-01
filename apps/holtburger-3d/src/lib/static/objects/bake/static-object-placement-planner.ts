import type {
	StaticBakeBatchItem,
	StaticScopePayload,
	StaticBakeTextureUse,
	StaticTextureUseOwner,
} from "../../contracts";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import type {
	ObjectVisualTexturePlacementIntent,
	TextureBindingRequirement,
} from "../../../textures/placement";
import {
	createObjectVisualStaticTexturePlacementIntent,
	createTexturePlacementItemId,
} from "../../../textures/placement";
import { createStaticObjectBatchPayload } from "./static-object-batch-payload";
import { partitionStaticObjectBatches } from "./static-object-batch-partitioner";
import { isCurrentlyStageableStaticObjectDataUse } from "./static-object-renderability";

export function createStaticObjectTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeBatchItem[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const intentsByTextureUseId = new Map<
		string,
		ObjectVisualTexturePlacementIntent
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
					if (intentsByTextureUseId.has(requirement.textureUseId)) {
						continue;
					}
					intentsByTextureUseId.set(
						requirement.textureUseId,
						createObjectVisualStaticTexturePlacementIntent(
							createStaticObjectPlanningTextureUse({
								domain: payload.domain,
								requirement,
							}),
							createTexturePlacementItemId(intentsByTextureUseId.size),
							{
								affinityKey: createStaticObjectPlacementAffinityKey({
									landblockId: payload.landblock.landblockId,
									ownerId: item.task.ownerId,
									partitionBatchKey: partition.batchKey,
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

function createStaticObjectPlanningTextureUse(options: {
	readonly domain: StaticBakeTextureUse["domain"];
	readonly requirement: TextureBindingRequirement;
}): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		domain: options.domain,
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

const NO_STATIC_TEXTURE_USE_OWNERS: readonly StaticTextureUseOwner[] = [];
