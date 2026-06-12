import type {
	MaterialTextureDataUseIdentity,
	ScheduledStaticWork,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
} from "../../contracts";
import {
	createMaterialTextureDataUseKey,
	partitionStaticObjectCompatibility,
	type StaticObjectCompatibilityPartition,
} from "./static-object-compatibility-partitioner";

export class StaticObjectCompatibilityBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeStaticObjectCompatibility(input);
	}
}

export function bakeStaticObjectCompatibility(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "outdoor-buildings" && input.domain !== "outdoor-detail") {
		throw new Error(
			`Static object compatibility baker only supports outdoor static object batches. Received ${input.domain}.`,
		);
	}

	const itemResults = input.items.map((item) =>
		bakeStaticObjectCompatibilityItem(input, item),
	);
	const drawUnits = itemResults.flatMap((result) => result.drawUnits);

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		revision: input.revision,
		staticAuthoredDynamicSeeds: [],
		staticBatchId: input.staticBatchId,
		staticPortalInteriorRecords: [],
		staticSourceMappings: itemResults.flatMap((result) => result.sourceMappings),
		staticSpatialRecords: itemResults.flatMap((result) => result.spatialRecords),
		staticVisibilityRecords: [],
		textureUses: mergeTextureUses(itemResults.flatMap((result) => result.textureUses)),
		works: input.items.map((item) => item.work),
	};
}

function bakeStaticObjectCompatibilityItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly sourceMappings: readonly string[];
	readonly spatialRecords: readonly string[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (
		(item.work.job.domain !== "outdoor-buildings" &&
			item.work.job.domain !== "outdoor-detail") ||
		item.payload.scope.kind !== "outdoor-static-objects"
	) {
		throw new Error(
			`Static object compatibility baker only supports outdoor static object payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const partitionPlan = partitionStaticObjectCompatibility(item.payload.scope);
	const drawUnits = partitionPlan.partitions.map((partition) =>
		createPartitionPlaceholderDrawUnit(item.work, partition),
	);
	const drawUnitIdBySliceId = new Map(
		partitionPlan.partitions.map((partition, index) => [
			partition.sliceId,
			drawUnits[index]?.drawUnitId ?? "",
		]),
	);

	return {
		drawUnits,
		sourceMappings: partitionPlan.partitions.flatMap((partition) => {
			const drawUnitId = drawUnitIdBySliceId.get(partition.sliceId);
			if (!drawUnitId) {
				return [];
			}
			return partition.sourceTriangleIds.map(
				(sourceTriangleId) => `${drawUnitId}:source:${sourceTriangleId}`,
			);
		}),
		spatialRecords: partitionPlan.partitions.map((partition) => {
			const drawUnitId = drawUnitIdBySliceId.get(partition.sliceId);
			return `${drawUnitId ?? partition.sliceId}:bounds:${partition.triangleCount}t`;
		}),
		textureUses: createStaticObjectBakeTextureUses({
			partitions: partitionPlan.partitions,
			staticBatchId: input.staticBatchId,
			work: item.work,
		}),
	};
}

function createPartitionPlaceholderDrawUnit(
	work: ScheduledStaticWork,
	partition: StaticObjectCompatibilityPartition,
): StaticDrawUnit {
	return {
		drawUnitId: `${work.workId}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`,
		kind: "placeholder",
	};
}

function createStaticObjectBakeTextureUses(options: {
	readonly work: ScheduledStaticWork;
	readonly staticBatchId: string;
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
}): readonly StaticBakeTextureUse[] {
	const textureUsesById = new Map<string, StaticBakeTextureUse>();

	for (const partition of options.partitions) {
		if (partition.renderCoverage !== "classified-render-candidate") {
			continue;
		}

		const drawUnitId = `${options.work.workId}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`;
		for (const dataUse of partition.textureDataUses) {
			if (!isCurrentlyStageableStaticObjectDataUse(dataUse)) {
				continue;
			}

			const textureUseId = [
				options.work.workId,
				"static-object-texture",
				createMaterialTextureDataUseKey(dataUse),
			].join(":");
			const existing = textureUsesById.get(textureUseId);
			if (existing) {
				textureUsesById.set(textureUseId, {
					...existing,
					ownerDrawUnitIds: [...existing.ownerDrawUnitIds, drawUnitId],
				});
				continue;
			}

			textureUsesById.set(textureUseId, {
				domain: options.work.job.domain,
				ownerDrawUnitIds: [drawUnitId],
				source: dataUse,
				staticBatchId: options.staticBatchId,
				textureUseId,
			});
		}
	}

	return [...textureUsesById.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function mergeTextureUses(
	textureUses: readonly StaticBakeTextureUse[],
): readonly StaticBakeTextureUse[] {
	const merged = new Map<string, StaticBakeTextureUse>();

	for (const textureUse of textureUses) {
		const existing = merged.get(textureUse.textureUseId);
		if (existing) {
			merged.set(textureUse.textureUseId, {
				...existing,
				ownerDrawUnitIds: [
					...existing.ownerDrawUnitIds,
					...textureUse.ownerDrawUnitIds,
				],
			});
			continue;
		}
		merged.set(textureUse.textureUseId, textureUse);
	}

	return [...merged.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function isCurrentlyStageableStaticObjectDataUse(
	dataUse: MaterialTextureDataUseIdentity,
): boolean {
	return (
		dataUse.kind === "prepared-render-surface-texture-use" &&
		dataUse.usage === "rgba-raw"
	);
}
