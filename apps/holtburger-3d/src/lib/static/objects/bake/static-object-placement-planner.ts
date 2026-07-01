import type {
	StaticBakeBatchItem,
	StaticScopePayload,
	StaticBakeTextureUse,
	StaticTextureUseOwner,
} from "../../contracts";
import {
	createStaticMaterialTextureSamplingPolicy,
	createStaticMaterialTextureUseId,
} from "../../bake/static-material-texture-policy";
import type { TexturePlacementIntent } from "../../../textures/placement";
import { createStaticTexturePlacementIntent } from "../../../textures/placement";
import { createStaticObjectBatchPayload } from "./static-object-batch-payload";
import { partitionStaticObjectBatches } from "./static-object-batch-partitioner";
import { isCurrentlyStageableStaticObjectDataUse } from "./static-object-renderability";

export function createStaticObjectTexturePlacementIntents(input: {
	readonly items: readonly StaticBakeBatchItem[];
	readonly staticBatchId: string;
}): readonly TexturePlacementIntent[] {
	const intentsByItemId = new Map<string, TexturePlacementIntent>();

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
					const textureUseId = createStaticMaterialTextureUseId({
						dataUse,
						textureUseNamespace: "static-object-texture",
						textureUseScopeId: item.task.ownerId,
						wrapMode: entry.textureWrapMode,
					});
					if (intentsByItemId.has(textureUseId)) {
						continue;
					}
					const textureUse: StaticBakeTextureUse = {
						domain: payload.domain,
						owners: NO_STATIC_TEXTURE_USE_OWNERS,
						samplingPolicy: createStaticMaterialTextureSamplingPolicy({
							dataUse,
							wrapMode: entry.textureWrapMode,
						}),
						source: dataUse,
						staticBatchId: input.staticBatchId,
						textureUseId,
					};
					intentsByItemId.set(
						textureUseId,
						createStaticTexturePlacementIntent(textureUse, {
							affinityKey: createStaticObjectPlacementAffinityKey({
								landblockId: payload.landblock.landblockId,
								ownerId: item.task.ownerId,
								partitionBatchKey: partition.batchKey,
							}),
						}),
					);
				}
			}
		}
	}

	return [...intentsByItemId.values()].sort((left, right) =>
		left.itemId.localeCompare(right.itemId),
	);
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
