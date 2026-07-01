import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTask,
	StaticBounds,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectDrawUnitOwnership,
	StaticObjectBakeDiagnostics,
	StaticMaterialTableEntry,
	StaticObjectInstanceIdentity,
	StaticEnvCellStaticObjectSpatialRecord,
	StaticObjectSourceGeometryAttachment,
	StaticObjectPartSourceFacts,
	StaticObjectSourceMappingCoverage,
	StaticObjectSortMetadata,
	StaticObjectSourceIdentity,
	StaticSpatialRecord,
	StaticLayerPeerRecordOwner,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticObjectSourceGeometryIdentity,
	StaticObjectInstanceFacts,
	StaticObjectRetainedTransparentPartitionReasonCounts,
} from "../../contracts";
import { uniqueSortedStaticTextureUseOwners } from "../../contracts";
import type {
	TextureResourceDependencies,
	TextureResourceRoleDependency,
} from "../../../textures/placement";
import { requireObjectVisualTexturePlacementSnapshot } from "../../../textures/placement";
import { createLayerPeerRecordOwnerForStaticBakeTask } from "../../layer-owners";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
	writeTexCoord,
	writeTransformedPosition,
} from "../../../math/ac-placement-transform";
import {
	createStaticMaterialTableEntry,
	createStaticMaterialTextureUses,
} from "../../bake/static-material-adapter";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import { emitStaticBakeWorkerTrace } from "../../bake/worker-trace";
import {
	describeStaticObjectCanonicalGeometryIdentity,
	describeStaticObjectSourceGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static-object-source-assets";
import {
	partitionStaticObjectBatches,
	type StaticObjectBatchPayload,
	type StaticObjectBatchPartition,
	type StaticObjectBatchTriangle,
} from "./static-object-batch-partitioner";
import {
	isCurrentlyStageableStaticObjectDataUse,
	isRenderableStaticObjectPartition,
} from "./static-object-renderability";
import {
	createStaticObjectVisualResourceId,
	createStaticObjectVisualResourceKey,
	createStaticObjectVisualResourceKeyString,
} from "../static-object-visual-resource-key";
import { createStaticObjectBatchPayload } from "./static-object-batch-payload";
import { createStaticBakeObjectVisualInstallSet } from "../../bake/object-visual-install-set-publication";

export class StaticObjectBatchBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeStaticObjectBatch(input);
	}
}

export function bakeStaticObjectBatch(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (
		input.domain !== "outdoor-buildings" &&
		input.domain !== "outdoor-explicit-objects" &&
		input.domain !== "outdoor-generated-scenery" &&
		input.domain !== "env-cell-system"
	) {
		throw new Error(
			`Static object batch baker only supports static object batches. Received ${input.domain}.`,
		);
	}

	emitStaticBakeWorkerTrace("static-object-batch:start", {
		bakeBatchId: input.bakeBatchId,
		domain: input.domain,
		itemCount: input.items.length,
		revision: input.revision,
	});
	const itemResults = input.items.map((item, index) =>
		bakeStaticObjectBatchItem(input, item, index),
	);
	const drawUnits = itemResults.flatMap((result) => result.drawUnits);
	const staticObjectRenderInstances = itemResults.flatMap(
		(result) => result.staticObjectRenderInstances,
	);
	const staticObjectVisualResources = dedupeStaticObjectVisualResources(
		itemResults.flatMap((result) => result.staticObjectVisualResources),
	);
	const textureDependencies = itemResults.flatMap(
		(result) => result.textureDependencies,
	);
	emitStaticBakeWorkerTrace("static-object-batch:end", {
		bakeBatchId: input.bakeBatchId,
		domain: input.domain,
		drawUnitCount: drawUnits.length,
		itemCount: input.items.length,
	});

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		staticObjectRenderInstances,
		staticObjectVisualResources,
		staticObjectBakeDiagnostics: itemResults.map(
			(result) => result.diagnostics,
		),
		materialCoverage: itemResults.map((result) => result.materialCoverage),
		objectVisualInstallSet: createStaticBakeObjectVisualInstallSet({
			drawUnits,
			staticObjectRenderInstances,
			staticObjectVisualResources,
			textureDependencies,
		}),
		portalApertureResources: [],
		revision: input.revision,
		envCellStaticObjectPlacementRecords: [],
		bakeBatchId: input.bakeBatchId,
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: itemResults.flatMap(
			(result) => result.sourceMappings,
		),
		staticSpatialRecords: itemResults.flatMap(
			(result) => result.spatialRecords,
		),
		staticVisibilityRecords: [],
		textureUses: mergeTextureUses(
			itemResults.flatMap((result) => result.textureUses),
		),
		textureDependencies,
		tasks: input.items.map((item) => item.task),
	};
}

function createStaticObjectSourceMappingCoverage(
	partition: StaticObjectBatchPartition,
): readonly StaticObjectSourceMappingCoverage[] {
	const materialSlotByEntryKey = new Map(
		partition.coarseTablePlan.entries.map((entry, slot) => [
			entry.materialEntryKey,
			slot,
		]),
	);
	const materialIdsBySlot = new Map(
		partition.coarseTablePlan.entries.map((entry, slot) => [
			slot,
			entry.materialIds,
		]),
	);
	const buckets = new Map<
		string,
		{
			readonly object: StaticObjectInstanceIdentity;
			readonly source: StaticObjectSourceIdentity;
			readonly gfxObj: StaticObjectSourceIdentity;
			readonly partIndex: number;
			readonly materialSlot: number;
			readonly materialIds: readonly number[];
			readonly geometrySurfaceIds: Set<number>;
			readonly materialVariantSignatures: Set<string | null>;
			readonly polygonIds: Set<number>;
			sourceTriangleCount: number;
			minPolygonId: number | null;
			maxPolygonId: number | null;
		}
	>();

	for (const triangle of partition.triangles) {
		const materialSlot = materialSlotByEntryKey.get(triangle.materialEntryKey);
		if (materialSlot === undefined) {
			throw new Error(
				`Renderable static object partition ${partition.sliceId} references missing material entry ${triangle.materialEntryKey}.`,
			);
		}
		const bucketKey = [
			createObjectKey(triangle.object),
			createSourceKey(triangle.source),
			createSourceKey(triangle.gfxObj),
			triangle.partIndex,
			materialSlot,
		].join("|");
		const bucket = buckets.get(bucketKey) ?? {
			geometrySurfaceIds: new Set<number>(),
			gfxObj: triangle.gfxObj,
			materialIds: materialIdsBySlot.get(materialSlot) ?? [],
			materialSlot,
			materialVariantSignatures: new Set<string | null>(),
			maxPolygonId: null,
			minPolygonId: null,
			object: triangle.object,
			partIndex: triangle.partIndex,
			polygonIds: new Set<number>(),
			source: triangle.source,
			sourceTriangleCount: 0,
		};

		bucket.geometrySurfaceIds.add(triangle.geometrySurfaceId);
		bucket.materialVariantSignatures.add(triangle.materialVariantSignature);
		bucket.polygonIds.add(triangle.polygonId);
		bucket.sourceTriangleCount += 1;
		bucket.minPolygonId =
			bucket.minPolygonId === null
				? triangle.polygonId
				: Math.min(bucket.minPolygonId, triangle.polygonId);
		bucket.maxPolygonId =
			bucket.maxPolygonId === null
				? triangle.polygonId
				: Math.max(bucket.maxPolygonId, triangle.polygonId);
		buckets.set(bucketKey, bucket);
	}

	return [...buckets.values()]
		.map(
			(bucket): StaticObjectSourceMappingCoverage => ({
				geometrySurfaceIds: [...bucket.geometrySurfaceIds].sort(
					(left, right) => left - right,
				),
				gfxObj: bucket.gfxObj,
				materialIds: [...bucket.materialIds].sort(
					(left, right) => left - right,
				),
				materialSlot: bucket.materialSlot,
				materialVariantSignatures: [...bucket.materialVariantSignatures].sort(
					compareNullableStrings,
				),
				object: bucket.object,
				partIndex: bucket.partIndex,
				polygonCount: bucket.polygonIds.size,
				polygonRange:
					bucket.minPolygonId === null || bucket.maxPolygonId === null
						? null
						: { max: bucket.maxPolygonId, min: bucket.minPolygonId },
				source: bucket.source,
				sourceTriangleCount: bucket.sourceTriangleCount,
			}),
		)
		.sort(compareSourceMappingCoverage);
}

function bakeStaticObjectBatchItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
	itemIndex: number,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticBakeBatchResult["materialCoverage"][number];
	readonly diagnostics: StaticObjectBakeDiagnostics;
	readonly sourceMappings: StaticBakeBatchResult["staticSourceMappings"];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
	readonly task: StaticBakeBatchItem["task"];
} {
	emitStaticBakeWorkerTrace("static-object-item:start", {
		domain: item.task.domain,
		itemIndex,
		ownerId: item.task.ownerId,
		scopeKey: item.task.scopeKey,
	});
	const scope = createStaticObjectBatchPayload(item);
	emitStaticBakeWorkerTrace("static-object-item:payload", {
		domain: scope.domain,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		objectCount: scope.objects.length,
		sourceAssetCount: scope.sourceAssets.length,
		textureRefCount: scope.textureRefs.length,
	});
	const sourceIndex = new StaticObjectBakeSourceIndex(scope, input.attachments);
	const resourceIdPrefix = item.task.ownerId;
	const partitionPlan = partitionStaticObjectBatches(scope, {
		placementSnapshot: requireObjectVisualTexturePlacementSnapshot(
			input.texturePlacementSnapshot,
			"Static object bake",
		),
		textureUseScopeId: resourceIdPrefix,
	});
	emitStaticBakeWorkerTrace("static-object-item:partitioned", {
		domain: scope.domain,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		partitionCount: partitionPlan.partitions.length,
	});
	const renderablePartitions = partitionPlan.partitions.filter((partition) => {
		if (isRenderableStaticObjectPartition(partition)) {
			return true;
		}

		warnAboutSkippedStaticObjectPartition(item.task, scope, partition);
		return false;
	});
	const instancedOutput = createStaticObjectInstancedOutput({
		partitions: renderablePartitions,
		payload: scope,
		resourceIdPrefix,
		sourceIndex,
		bakeBatchId: input.bakeBatchId,
		task: item.task,
	});
	emitStaticBakeWorkerTrace("static-object-item:instanced", {
		cutoverPartitionCount: instancedOutput.cutoverPartitionSliceIds.size,
		domain: scope.domain,
		instanceCount: instancedOutput.instances.length,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		resourceCount: instancedOutput.resources.length,
	});
	const bakedPartitions = renderablePartitions.filter(
		(partition) =>
			!instancedOutput.cutoverPartitionSliceIds.has(partition.sliceId),
	);
	const drawUnits = bakedPartitions.map((partition) =>
		createStaticObjectGeometryBakeOutput({
			partition,
			payload: scope,
			resourceIdPrefix,
			sourceIndex,
			task: item.task,
		}),
	);
	emitStaticBakeWorkerTrace("static-object-item:direct-geometry", {
		bakedPartitionCount: bakedPartitions.length,
		domain: scope.domain,
		drawUnitCount: drawUnits.length,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
	});
	const drawUnitIdBySliceId = new Map(
		bakedPartitions.map((partition, index) => [
			partition.sliceId,
			drawUnits[index]?.drawUnit.drawUnitId ?? "",
		]),
	);
	const sourceMappingCoverageBySliceId = new Map(
		bakedPartitions.map(
			(partition) =>
				[
					partition.sliceId,
					createStaticObjectSourceMappingCoverage(partition),
				] as const,
		),
	);
	const spatialRecordBySliceId = new Map(
		bakedPartitions.map((partition) => {
			const drawUnitId = drawUnitIdBySliceId.get(partition.sliceId);
			return [
				partition.sliceId,
				createDrawUnitSpatialRecord(
					drawUnitId ?? partition.sliceId,
					partition.triangleCount,
				),
			] as const;
		}),
	);

	const bakedDrawUnits = drawUnits.map((output, index) => ({
		...output.drawUnit,
		sourceMappingCoverage:
			sourceMappingCoverageBySliceId.get(
				bakedPartitions[index]?.sliceId ?? "",
			) ?? [],
		spatialRecord:
			spatialRecordBySliceId.get(bakedPartitions[index]?.sliceId ?? "") ?? null,
	}));
	const textureUses = createStaticObjectBakeTextureUses({
		partitions: bakedPartitions,
		resourceIdPrefix,
		bakeBatchId: input.bakeBatchId,
		task: item.task,
	}).concat(instancedOutput.textureUses);
	emitStaticBakeWorkerTrace("static-object-item:end", {
		domain: scope.domain,
		drawUnitCount: bakedDrawUnits.length,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		textureUseCount: textureUses.length,
	});

	return {
		drawUnits: bakedDrawUnits,
		diagnostics: createStaticObjectBakeDiagnostics({
			drawUnits: drawUnits.map((output) => output.drawUnit),
			input,
			instancedOutput,
			partitionPlan,
			payload: scope,
			retainedBakedPartitions: bakedPartitions,
			sourceIndex,
			renderablePartitionCount: renderablePartitions.length,
		}),
		materialCoverage: partitionPlan.materialCoverage,
		sourceMappings: [],
		spatialRecords: [
			...spatialRecordBySliceId.values(),
			...drawUnits.flatMap((output) => output.objectSpatialRecords),
		],
		staticObjectRenderInstances: instancedOutput.instances,
		staticObjectVisualResources: instancedOutput.resources,
		textureDependencies:
			createStaticObjectDrawUnitTextureDependencies(bakedDrawUnits),
		textureUses,
		task: item.task,
	};
}

function createStaticObjectDrawUnitTextureDependencies(
	drawUnits: readonly StaticDrawUnit[],
): readonly TextureResourceDependencies[] {
	return drawUnits.flatMap((drawUnit) => {
		if (drawUnit.kind !== "static-object-geometry") {
			return [];
		}
		const roles = createStaticObjectDrawUnitTextureRoleDependencies(drawUnit);
		if (roles.length === 0) {
			return [];
		}
		return [
			{
				resourceId: drawUnit.drawUnitId,
				roles,
			},
		];
	});
}

function createStaticObjectDrawUnitTextureRoleDependencies(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): readonly TextureResourceRoleDependency[] {
	const baseColor = new Set<string>();
	const detail = new Set<string>();
	const index = new Set<string>();
	const palette = new Set<string>();
	for (const entry of drawUnit.materialEntries) {
		addNullableString(baseColor, entry.primaryTextureUseId);
		addNullableString(detail, entry.detailTextureUseId);
		addNullableString(index, entry.indexTextureUseId);
		addNullableString(palette, entry.paletteTextureUseId);
	}

	return [
		createRoleDependency("object-base-color", baseColor),
		createRoleDependency("object-detail", detail),
		createRoleDependency("object-index", index),
		createRoleDependency("object-palette", palette),
	].filter((role): role is TextureResourceRoleDependency => role !== null);
}

function createRoleDependency(
	purpose: TextureResourceRoleDependency["purpose"],
	itemIds: ReadonlySet<string>,
): TextureResourceRoleDependency | null {
	if (itemIds.size === 0) {
		return null;
	}
	return {
		itemIds: [...itemIds].sort((left, right) => left.localeCompare(right)),
		purpose,
	};
}

function addNullableString(values: Set<string>, value: string | null): void {
	if (value) {
		values.add(value);
	}
}

function createStaticObjectBakeDiagnostics(options: {
	readonly input: StaticBakeBatchInput;
	readonly instancedOutput: {
		readonly instances: readonly StaticObjectRenderInstance[];
		readonly resources: readonly StaticObjectVisualResource[];
	};
	readonly payload: StaticObjectBatchPayload;
	readonly partitionPlan: ReturnType<typeof partitionStaticObjectBatches>;
	readonly retainedBakedPartitions: readonly StaticObjectBatchPartition[];
	readonly sourceIndex: StaticObjectBakeSourceIndex;
	readonly renderablePartitionCount: number;
	readonly drawUnits: readonly StaticObjectGeometryStaticDrawUnit[];
}): StaticObjectBakeDiagnostics {
	const uniqueSourceKeys = new Set<string>();
	const uniqueSourcePartGeometryKeys = new Set<string>();
	let uniqueSourceTriangleCount = 0;
	for (const source of options.payload.sourceAssets) {
		uniqueSourceKeys.add(createSourceKey(source.identity));
		uniqueSourceTriangleCount += source.renderTriangleCount;
		for (const part of source.parts) {
			uniqueSourcePartGeometryKeys.add(
				[
					createSourceKey(source.identity),
					`part:${part.partIndex}`,
					describeStaticObjectSourceGeometryIdentity(part.geometry),
				].join(":"),
			);
		}
	}

	const flattenedTriangleCount = sumNumbers(
		options.drawUnits.map((drawUnit) => drawUnit.triangleCount),
	);
	const flattenedVertexCount = sumNumbers(
		options.drawUnits.map((drawUnit) => drawUnit.vertexCount),
	);
	const instancingDiagnostics = createStaticObjectInstancingBakeDiagnostics(
		options.instancedOutput,
	);

	return {
		buildingObjectCount: options.payload.objects.filter(
			(object) => object.identity.objectKind === "building",
		).length,
		domain: options.payload.domain,
		drawUnitCount: options.drawUnits.length,
		estimatedFlattenedTypedArrayBytes: sumNumbers(
			options.drawUnits.map(estimateStaticObjectDrawUnitTypedArrayBytes),
		),
		explicitObjectCount: options.payload.objects.filter(
			(object) => object.identity.objectKind === "explicit-object",
		).length,
		flattenedTriangleCount,
		flattenedVertexCount,
		generatedInstanceCount: options.payload.objects.filter(
			(object) => object.identity.objectKind === "generated-scenery",
		).length,
		estimatedAvoidedFlattenedTriangleCount:
			instancingDiagnostics.estimatedAvoidedFlattenedTriangleCount,
		estimatedAvoidedFlattenedTypedArrayBytes:
			instancingDiagnostics.estimatedAvoidedFlattenedTypedArrayBytes,
		estimatedInstancedSourceTypedArrayBytes:
			instancingDiagnostics.estimatedInstancedSourceTypedArrayBytes,
		instancedRenderInstanceCount:
			instancingDiagnostics.instancedRenderInstanceCount,
		instancedSourceTriangleCount:
			instancingDiagnostics.instancedSourceTriangleCount,
		instancedVisualResourceCount:
			instancingDiagnostics.instancedVisualResourceCount,
		kind: "static-object-bake-diagnostics",
		landblockId: options.payload.landblock.landblockId,
		objectCount: options.payload.objects.length,
		partitionCount: options.partitionPlan.partitions.length,
		renderablePartitionCount: options.renderablePartitionCount,
		retainedTransparentOutdoorGeneratedSceneryPartitionReasons:
			createRetainedTransparentOutdoorGeneratedSceneryPartitionReasons({
				partitions: options.retainedBakedPartitions,
				payload: options.payload,
				sourceIndex: options.sourceIndex,
			}),
		skippedPartitionCount:
			options.partitionPlan.partitions.length -
			options.renderablePartitionCount,
		bakeBatchId: options.input.bakeBatchId,
		uniqueSourceCount: uniqueSourceKeys.size,
		uniqueSourcePartGeometryCount: uniqueSourcePartGeometryKeys.size,
		uniqueSourceTriangleCount,
	};
}

function createStaticObjectInstancingBakeDiagnostics(input: {
	readonly instances: readonly StaticObjectRenderInstance[];
	readonly resources: readonly StaticObjectVisualResource[];
}): Pick<
	StaticObjectBakeDiagnostics,
	| "estimatedAvoidedFlattenedTriangleCount"
	| "estimatedAvoidedFlattenedTypedArrayBytes"
	| "estimatedInstancedSourceTypedArrayBytes"
	| "instancedRenderInstanceCount"
	| "instancedSourceTriangleCount"
	| "instancedVisualResourceCount"
> {
	const instanceCountByResourceId = new Map<string, number>();
	for (const instance of input.instances) {
		instanceCountByResourceId.set(
			instance.resourceId,
			(instanceCountByResourceId.get(instance.resourceId) ?? 0) + 1,
		);
	}

	let estimatedAvoidedFlattenedTriangleCount = 0;
	let estimatedAvoidedFlattenedTypedArrayBytes = 0;
	let estimatedInstancedSourceTypedArrayBytes = 0;
	let instancedSourceTriangleCount = 0;
	for (const resource of input.resources) {
		const resourceBytes =
			estimateStaticObjectVisualResourceTypedArrayBytes(resource);
		const instanceCount =
			instanceCountByResourceId.get(resource.resourceId) ?? 0;
		estimatedInstancedSourceTypedArrayBytes += resourceBytes;
		instancedSourceTriangleCount += resource.triangleCount;
		estimatedAvoidedFlattenedTriangleCount +=
			resource.triangleCount * Math.max(instanceCount - 1, 0);
		estimatedAvoidedFlattenedTypedArrayBytes +=
			resourceBytes * Math.max(instanceCount - 1, 0);
	}

	return {
		estimatedAvoidedFlattenedTriangleCount,
		estimatedAvoidedFlattenedTypedArrayBytes,
		estimatedInstancedSourceTypedArrayBytes,
		instancedRenderInstanceCount: input.instances.length,
		instancedSourceTriangleCount,
		instancedVisualResourceCount: input.resources.length,
	};
}

function createRetainedTransparentOutdoorGeneratedSceneryPartitionReasons(options: {
	readonly partitions: readonly StaticObjectBatchPartition[];
	readonly payload: StaticObjectBatchPayload;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): StaticObjectRetainedTransparentPartitionReasonCounts {
	const counts = createEmptyRetainedTransparentPartitionReasonCounts();
	if (options.payload.domain !== "outdoor-generated-scenery") {
		return counts;
	}

	const generatedObjectCountBySourceLocalTriangleKey =
		createGeneratedObjectCountBySourceLocalTriangleKey(options.partitions);
	for (const partition of options.partitions) {
		if (
			resolveRenderableStaticObjectPass(partition) !== "transparent" &&
			resolveRenderableStaticObjectPass(partition) !== "additive"
		) {
			continue;
		}
		incrementRetainedTransparentPartitionReason(
			counts,
			classifyRetainedTransparentPartition({
				generatedObjectCountBySourceLocalTriangleKey,
				partition,
				sourceIndex: options.sourceIndex,
			}),
		);
	}
	return counts;
}

function createGeneratedObjectCountBySourceLocalTriangleKey(
	partitions: readonly StaticObjectBatchPartition[],
): ReadonlyMap<string, number> {
	const objectKeysBySourceLocalTriangleKey = new Map<string, Set<string>>();
	for (const partition of partitions) {
		for (const triangle of partition.triangles) {
			if (triangle.object.objectKind !== "generated-scenery") {
				continue;
			}
			const sourceLocalTriangleKey =
				createStaticObjectSourceLocalTriangleKey(triangle);
			const objectKeys =
				objectKeysBySourceLocalTriangleKey.get(sourceLocalTriangleKey) ??
				new Set<string>();
			objectKeys.add(createObjectKey(triangle.object));
			objectKeysBySourceLocalTriangleKey.set(
				sourceLocalTriangleKey,
				objectKeys,
			);
		}
	}

	return new Map(
		[...objectKeysBySourceLocalTriangleKey].map(
			([sourceLocalTriangleKey, objectKeys]) =>
				[sourceLocalTriangleKey, objectKeys.size] as const,
		),
	);
}

function createEmptyRetainedTransparentPartitionReasonCounts(): StaticObjectRetainedTransparentPartitionReasonCounts {
	return {
		explicitObject: 0,
		missingInstanceBounds: 0,
		nonRenderableOrDeferredMaterialBucket: 0,
		oneOffGeneratedSource: 0,
		repeatedGeneratedSourceRetainedByPartitionPolicy: 0,
		unsupportedMaterialBucket: 0,
	};
}

type RetainedTransparentPartitionReason =
	keyof StaticObjectRetainedTransparentPartitionReasonCounts;

function classifyRetainedTransparentPartition(options: {
	readonly generatedObjectCountBySourceLocalTriangleKey: ReadonlyMap<
		string,
		number
	>;
	readonly partition: StaticObjectBatchPartition;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): RetainedTransparentPartitionReason {
	const { partition, sourceIndex } = options;
	if (partition.renderCoverage !== "classified-render-candidate") {
		return partition.family === "unsupported"
			? "unsupportedMaterialBucket"
			: "nonRenderableOrDeferredMaterialBucket";
	}

	let hasGenerated = false;
	let hasNonGenerated = false;
	let missingInstanceBounds = false;
	let hasRepeatedGeneratedSource = false;
	for (const triangle of partition.triangles) {
		if (triangle.object.objectKind !== "generated-scenery") {
			hasNonGenerated = true;
			continue;
		}
		hasGenerated = true;
		hasRepeatedGeneratedSource ||=
			(options.generatedObjectCountBySourceLocalTriangleKey.get(
				createStaticObjectSourceLocalTriangleKey(triangle),
			) ?? 0) > 1;
		const candidate = selectGeneratedStaticObjectRenderInstanceCandidate(
			sourceIndex.getObject(triangle.object),
		);
		if (candidate.kind === "ineligible") {
			missingInstanceBounds ||= candidate.reason === "missing-instance-bounds";
		}
	}

	if (!hasGenerated) {
		return "explicitObject";
	}
	if (missingInstanceBounds) {
		return "missingInstanceBounds";
	}
	if (hasNonGenerated) {
		return "repeatedGeneratedSourceRetainedByPartitionPolicy";
	}
	if (!hasRepeatedGeneratedSource) {
		return "oneOffGeneratedSource";
	}
	return "repeatedGeneratedSourceRetainedByPartitionPolicy";
}

function incrementRetainedTransparentPartitionReason(
	counts: {
		explicitObject: number;
		missingInstanceBounds: number;
		nonRenderableOrDeferredMaterialBucket: number;
		oneOffGeneratedSource: number;
		repeatedGeneratedSourceRetainedByPartitionPolicy: number;
		unsupportedMaterialBucket: number;
	},
	reason: RetainedTransparentPartitionReason,
): void {
	counts[reason] += 1;
}

function estimateStaticObjectDrawUnitTypedArrayBytes(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): number {
	return (
		drawUnit.positions.byteLength +
		drawUnit.texCoords.byteLength +
		drawUnit.materialSlotIndices.byteLength +
		drawUnit.indices.byteLength
	);
}

function estimateStaticObjectVisualResourceTypedArrayBytes(
	resource: StaticObjectVisualResource,
): number {
	return (
		resource.positions.byteLength +
		resource.texCoords.byteLength +
		resource.materialSlotIndices.byteLength +
		resource.indices.byteLength
	);
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

function createStaticObjectInstancedOutput(options: {
	readonly partitions: readonly StaticObjectBatchPartition[];
	readonly payload: StaticObjectBatchPayload;
	readonly resourceIdPrefix: string;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
	readonly bakeBatchId: string;
	readonly task: StaticBakeTask;
}): {
	readonly cutoverPartitionSliceIds: ReadonlySet<string>;
	readonly instances: readonly StaticObjectRenderInstance[];
	readonly resources: readonly StaticObjectVisualResource[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (options.payload.domain !== "outdoor-generated-scenery") {
		return {
			cutoverPartitionSliceIds: new Set<string>(),
			instances: [],
			resources: [],
			textureUses: [],
		};
	}

	emitStaticBakeWorkerTrace("static-object-instancing:start", {
		domain: options.payload.domain,
		landblockId: formatHex32(options.payload.landblock.landblockId),
		partitionCount: options.partitions.length,
		triangleCount: sumNumbers(
			options.partitions.map((partition) => partition.triangleCount),
		),
	});
	const groupsByKey = new Map<
		string,
		StaticObjectVisualResourceTriangleGroup
	>();
	const triangleCoverageKeysByPartitionSliceId = new Map<string, Set<string>>();
	let generatedTriangleCount = 0;
	let eligibleTriangleCount = 0;
	for (const partition of options.partitions) {
		triangleCoverageKeysByPartitionSliceId.set(
			partition.sliceId,
			new Set(
				partition.triangles.map((triangle) =>
					createStaticObjectTriangleCoverageKey(partition, triangle),
				),
			),
		);
		const materialEntries = createStaticObjectMaterialTableEntries({
			partition,
			textureUseScopeId: options.resourceIdPrefix,
		});
		const materialEntryByKey = new Map(
			partition.coarseTablePlan.entries.map((entry, index) => [
				entry.materialEntryKey,
				materialEntries[index],
			]),
		);

		for (const triangle of partition.triangles) {
			if (triangle.object.objectKind !== "generated-scenery") {
				continue;
			}
			generatedTriangleCount += 1;
			const object = options.sourceIndex.getObject(triangle.object);
			const candidate =
				selectGeneratedStaticObjectRenderInstanceCandidate(object);
			if (candidate.kind === "ineligible") {
				continue;
			}
			eligibleTriangleCount += 1;
			const materialEntry = materialEntryByKey.get(triangle.materialEntryKey);
			if (!materialEntry) {
				continue;
			}
			const coarseMaterialEntry = partition.coarseTablePlan.entries.find(
				(entry) => entry.materialEntryKey === triangle.materialEntryKey,
			);
			if (!coarseMaterialEntry) {
				continue;
			}
			const part = options.sourceIndex.getPart(
				triangle.source,
				triangle.gfxObj,
				triangle.partIndex,
			);
			const geometry = part.geometry;
			const materialFamily = resolveRenderableStaticObjectFamily(partition);
			const materialPass = resolveRenderableStaticObjectPass(partition);
			const textureUseIds = textureUseIdsForMaterialEntry(materialEntry);
			const groupingPartitionSliceId =
				materialPass === "transparent" || materialPass === "additive"
					? null
					: partition.sliceId;
			const groupKey = createStaticObjectVisualResourceTriangleGroupKey({
				geometry,
				materialEntries: [materialEntry],
				materialFamily,
				materialPass,
				partitionSliceId: groupingPartitionSliceId,
				renderState: materialEntry.renderState,
				textureUseIds,
			});
			const group = groupsByKey.get(groupKey) ?? {
				candidatesByInstanceId: new Map(),
				candidatePartitionSliceIdsByInstanceId: new Map(),
				coveredTriangleKeysByPartitionSliceId: new Map(),
				geometry,
				materialEntry,
				materialFamily,
				materialPass,
				sourceTrianglesById: new Map(),
				textureDataUses: coarseMaterialEntry.textureDataUses,
				textureUseIds,
				textureWrapMode: coarseMaterialEntry.textureWrapMode,
			};
			group.candidatesByInstanceId.set(
				candidate.object.identity.instanceId,
				candidate,
			);
			const candidatePartitionSliceIds =
				group.candidatePartitionSliceIdsByInstanceId.get(
					candidate.object.identity.instanceId,
				) ?? new Set<string>();
			candidatePartitionSliceIds.add(partition.sliceId);
			group.candidatePartitionSliceIdsByInstanceId.set(
				candidate.object.identity.instanceId,
				candidatePartitionSliceIds,
			);
			const coveredTriangleKeys =
				group.coveredTriangleKeysByPartitionSliceId.get(partition.sliceId) ??
				new Set<string>();
			coveredTriangleKeys.add(
				createStaticObjectTriangleCoverageKey(partition, triangle),
			);
			group.coveredTriangleKeysByPartitionSliceId.set(
				partition.sliceId,
				coveredTriangleKeys,
			);
			group.sourceTrianglesById.set(
				createStaticObjectSourceLocalTriangleKey(triangle),
				triangle,
			);
			groupsByKey.set(groupKey, group);
		}
	}
	emitStaticBakeWorkerTrace("static-object-instancing:groups", {
		domain: options.payload.domain,
		eligibleTriangleCount,
		generatedTriangleCount,
		groupCount: groupsByKey.size,
		landblockId: formatHex32(options.payload.landblock.landblockId),
	});

	const coveredTriangleKeysByPartitionSliceId = new Map<string, Set<string>>();
	for (const group of groupsByKey.values()) {
		if (group.candidatesByInstanceId.size < 2) {
			continue;
		}
		for (const [
			partitionSliceId,
			groupCoveredTriangleKeys,
		] of group.coveredTriangleKeysByPartitionSliceId) {
			const coveredTriangleKeys =
				coveredTriangleKeysByPartitionSliceId.get(partitionSliceId) ??
				new Set<string>();
			for (const triangleKey of groupCoveredTriangleKeys) {
				coveredTriangleKeys.add(triangleKey);
			}
			coveredTriangleKeysByPartitionSliceId.set(
				partitionSliceId,
				coveredTriangleKeys,
			);
		}
	}

	const cutoverPartitionSliceIds = new Set<string>();
	for (const [
		partitionSliceId,
		triangleCoverageKeys,
	] of triangleCoverageKeysByPartitionSliceId) {
		const coveredTriangleKeys =
			coveredTriangleKeysByPartitionSliceId.get(partitionSliceId);
		if (
			coveredTriangleKeys &&
			[...triangleCoverageKeys].every((triangleKey) =>
				coveredTriangleKeys.has(triangleKey),
			)
		) {
			cutoverPartitionSliceIds.add(partitionSliceId);
		}
	}
	emitStaticBakeWorkerTrace("static-object-instancing:cutover", {
		cutoverPartitionCount: cutoverPartitionSliceIds.size,
		domain: options.payload.domain,
		groupCount: groupsByKey.size,
		landblockId: formatHex32(options.payload.landblock.landblockId),
	});

	const resources: StaticObjectVisualResource[] = [];
	const instances: StaticObjectRenderInstance[] = [];
	const textureUses: StaticBakeTextureUse[] = [];
	let resourceBakeGroupCount = 0;
	for (const group of groupsByKey.values()) {
		if (group.candidatesByInstanceId.size < 2) {
			continue;
		}
		const cutoverCandidates = selectCutoverStaticObjectInstanceCandidates({
			cutoverPartitionSliceIds,
			group,
		});
		if (cutoverCandidates.length === 0) {
			continue;
		}
		resourceBakeGroupCount += 1;
		const resourceGeometry = bakeStaticObjectVisualResourceGeometry({
			materialSlot: group.materialEntry.slot,
			sourceIndex: options.sourceIndex,
			triangles: [...group.sourceTrianglesById.values()],
		});

		const resourceKey = createStaticObjectVisualResourceKey({
			geometry: group.geometry,
			indexType: resourceGeometry.indexType,
			materialEntries: [group.materialEntry],
			materialFamily: group.materialFamily,
			materialPass: group.materialPass,
			renderState: group.materialEntry.renderState,
			textureUseIds: group.textureUseIds,
		});
		const resourceId = createStaticObjectVisualResourceId(resourceKey);
		textureUses.push(
			...createStaticMaterialTextureUses({
				createTextureUseId: (dataUse, wrapMode) =>
					createStaticObjectTextureUseId({
						dataUse,
						textureUseScopeId: options.resourceIdPrefix,
						wrapMode,
					}),
				domain: options.payload.domain,
				isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
				bakeBatchId: options.bakeBatchId,
				textureUseSpecs: [
					{
						owners: [
							{
								kind: "static-object-visual-resource",
								resourceId,
							},
						],
						textureDataUses: group.textureDataUses,
						textureWrapMode: group.textureWrapMode,
					},
				],
			}),
		);
		resources.push({
			bounds: resourceGeometry.bounds,
			coordinateSpace: "static-object-source-local",
			geometry: group.geometry,
			indexType: resourceGeometry.indexType,
			indices: resourceGeometry.indices,
			key: resourceKey,
			kind: "static-object-visual-resource",
			materialEntries: [group.materialEntry],
			materialFamily: group.materialFamily,
			materialPass: group.materialPass,
			materialSlotIndices: resourceGeometry.materialSlotIndices,
			positions: resourceGeometry.positions,
			renderState: group.materialEntry.renderState,
			resourceId,
			texCoords: resourceGeometry.texCoords,
			textureUseIds: group.textureUseIds,
			triangleCount: resourceGeometry.triangleCount,
			vertexCount: resourceGeometry.vertexCount,
		});

		const part = options.sourceIndex.getPart(
			group.geometry.source,
			group.geometry.canonical.gfxObj,
			group.geometry.canonical.partIndex,
		);
		for (const candidate of cutoverCandidates) {
			instances.push({
				bounds: candidate.bounds,
				domain: options.payload.domain,
				generated: candidate.generated,
				instanceId: [
					"static-object-render-instance",
					candidate.object.identity.instanceId,
					`part:${group.geometry.canonical.partIndex}`,
					`slot:${group.materialEntry.slot}`,
				].join(":"),
				kind: "static-object-render-instance",
				landblockId: options.payload.landblock.landblockId,
				resourceId,
				sortCenter: centerVec3OfBounds(candidate.bounds),
				source: candidate.object.identity,
				sourceToLandblockMatrix: createStaticObjectSourcePartMatrix(
					candidate.object,
					part,
				),
				transform: candidate.object.localPlacement,
				transparency:
					group.materialPass === "transparent" ||
					group.materialPass === "additive"
						? {
								kind: "direct-sorted-transparent",
								sortCenter: centerVec3OfBounds(candidate.bounds),
							}
						: { kind: "depth-writing" },
			});
		}
	}
	emitStaticBakeWorkerTrace("static-object-instancing:end", {
		domain: options.payload.domain,
		instanceCount: instances.length,
		landblockId: formatHex32(options.payload.landblock.landblockId),
		resourceBakeGroupCount,
		resourceCount: resources.length,
		textureUseCount: textureUses.length,
	});

	return {
		cutoverPartitionSliceIds,
		instances: instances.sort((left, right) =>
			left.instanceId.localeCompare(right.instanceId),
		),
		resources: dedupeStaticObjectVisualResources(resources),
		textureUses: mergeTextureUses(textureUses),
	};
}

type GeneratedStaticObjectRenderInstanceCandidateEligibility =
	| {
			/** Candidate object with nullable host/content fields promoted to required render-instance facts. */
			readonly kind: "eligible";
			readonly object: StaticObjectInstanceFacts;
			readonly bounds: StaticBounds;
			readonly generated: NonNullable<StaticObjectInstanceFacts["generated"]>;
	  }
	| {
			/** Rejection reason kept local so nullable host data does not leak into candidate construction. */
			readonly kind: "ineligible";
			readonly reason:
				| "missing-object"
				| "missing-generated-facts"
				| "missing-instance-bounds";
	  };

interface StaticObjectVisualResourceTriangleGroup {
	readonly candidatesByInstanceId: Map<
		string,
		Extract<
			GeneratedStaticObjectRenderInstanceCandidateEligibility,
			{ readonly kind: "eligible" }
		>
	>;
	/** Partition slices touched by each candidate; all touched slices must cut over before emitting it. */
	readonly candidatePartitionSliceIdsByInstanceId: Map<string, Set<string>>;
	/** Triangle keys that this qualifying group can replace, tracked per baked partition slice. */
	readonly coveredTriangleKeysByPartitionSliceId: Map<string, Set<string>>;
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly materialEntry: StaticMaterialTableEntry;
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly sourceTrianglesById: Map<string, StaticObjectBatchTriangle>;
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly textureUseIds: readonly string[];
	readonly textureWrapMode: StaticObjectBatchPartition["textureWrapMode"];
}

function selectCutoverStaticObjectInstanceCandidates(options: {
	readonly cutoverPartitionSliceIds: ReadonlySet<string>;
	readonly group: StaticObjectVisualResourceTriangleGroup;
}): readonly Extract<
	GeneratedStaticObjectRenderInstanceCandidateEligibility,
	{ readonly kind: "eligible" }
>[] {
	return [...options.group.candidatesByInstanceId.values()]
		.filter((candidate) => {
			const partitionSliceIds =
				options.group.candidatePartitionSliceIdsByInstanceId.get(
					candidate.object.identity.instanceId,
				);
			return (
				partitionSliceIds !== undefined &&
				[...partitionSliceIds].every((partitionSliceId) =>
					options.cutoverPartitionSliceIds.has(partitionSliceId),
				)
			);
		})
		.sort((left, right) =>
			left.object.identity.instanceId.localeCompare(
				right.object.identity.instanceId,
			),
		);
}

function selectGeneratedStaticObjectRenderInstanceCandidate(
	object: StaticObjectInstanceFacts | undefined,
): GeneratedStaticObjectRenderInstanceCandidateEligibility {
	if (!object) {
		return { kind: "ineligible", reason: "missing-object" };
	}
	if (!object.generated) {
		return { kind: "ineligible", reason: "missing-generated-facts" };
	}
	if (!object.instanceBounds) {
		return { kind: "ineligible", reason: "missing-instance-bounds" };
	}
	return {
		bounds: object.instanceBounds,
		generated: object.generated,
		kind: "eligible",
		object,
	};
}

function createStaticObjectVisualResourceTriangleGroupKey(input: {
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly partitionSliceId: string | null;
	readonly renderState: StaticObjectGeometryStaticDrawUnit["renderState"];
	readonly textureUseIds: readonly string[];
}): string {
	const resourceKey = createStaticObjectVisualResourceKeyString(
		createStaticObjectVisualResourceKey({
			geometry: input.geometry,
			indexType: "uint32",
			materialEntries: input.materialEntries,
			materialFamily: input.materialFamily,
			materialPass: input.materialPass,
			renderState: input.renderState,
			textureUseIds: input.textureUseIds,
		}),
	);
	return [
		input.partitionSliceId ?? "cross-partition-generated",
		resourceKey,
	].join("|");
}

function createStaticObjectTriangleCoverageKey(
	partition: StaticObjectBatchPartition,
	triangle: StaticObjectBatchTriangle,
): string {
	return [
		partition.sliceId,
		createObjectKey(triangle.object),
		triangle.sourceTriangleId,
		triangle.materialEntryKey,
	].join("|");
}

function createStaticObjectSourceLocalTriangleKey(
	triangle: StaticObjectBatchTriangle,
): string {
	return [
		createSourceKey(triangle.source),
		createSourceKey(triangle.gfxObj),
		`part:${triangle.partIndex}`,
		`polygon:${triangle.polygonId}`,
		`first-vertex:${triangle.firstVertex}`,
		`geometry-surface:${triangle.geometrySurfaceId}`,
		`variant:${triangle.materialVariantSignature ?? "base"}`,
		`material:${triangle.materialEntryKey}`,
	].join("|");
}

function bakeStaticObjectVisualResourceGeometry(options: {
	readonly materialSlot: number;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
	readonly triangles: readonly StaticObjectBatchTriangle[];
}): {
	readonly bounds: StaticBounds | null;
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexType: StaticObjectGeometryStaticDrawUnit["indexType"];
	readonly vertexCount: number;
	readonly triangleCount: number;
} {
	const sortedTriangles = [...options.triangles].sort((left, right) =>
		left.sourceTriangleId.localeCompare(right.sourceTriangleId),
	);
	const vertexCount = sortedTriangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const texCoords = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices = createIndexArray(vertexCount);

	for (const [triangleIndex, triangle] of sortedTriangles.entries()) {
		const part = options.sourceIndex.getPart(
			triangle.source,
			triangle.gfxObj,
			triangle.partIndex,
		);
		const sourceGeometry = options.sourceIndex.getGeometry(part);
		const sourceTriangle = findStaticObjectSourceTriangle(part, triangle);

		for (let triangleVertex = 0; triangleVertex < 3; triangleVertex += 1) {
			const sourceVertexIndex = sourceTriangle.firstVertex + triangleVertex;
			const targetVertexIndex = triangleIndex * 3 + triangleVertex;
			copySourcePosition({
				source: sourceGeometry.buffer.positions,
				sourceVertexIndex,
				target: positions,
				targetVertexIndex,
			});
			writeTexCoord({
				source: sourceGeometry.buffer.texCoords,
				sourceVertexIndex,
				target: texCoords,
				targetVertexIndex,
			});
			materialSlotIndices[targetVertexIndex] = options.materialSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		bounds: computePositionBounds(positions),
		indexType: indices instanceof Uint16Array ? "uint16" : "uint32",
		indices,
		materialSlotIndices,
		positions,
		texCoords,
		triangleCount: sortedTriangles.length,
		vertexCount,
	};
}

function findStaticObjectSourceTriangle(
	part: StaticObjectPartSourceFacts,
	triangle: StaticObjectBatchTriangle,
): StaticObjectPartSourceFacts["triangles"][number] {
	const sourceTriangle = part.triangles.find(
		(candidate) =>
			candidate.polygonId === triangle.polygonId &&
			candidate.firstVertex === triangle.firstVertex &&
			candidate.geometrySurfaceId === triangle.geometrySurfaceId &&
			candidate.materialVariantSignature === triangle.materialVariantSignature,
	);
	if (!sourceTriangle) {
		throw new Error(
			`Static object visual resource references missing source triangle ${triangle.sourceTriangleId}.`,
		);
	}

	return sourceTriangle;
}

function copySourcePosition(options: {
	readonly source: Float32Array;
	readonly sourceVertexIndex: number;
	readonly target: Float32Array;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 3;
	const targetOffset = options.targetVertexIndex * 3;
	options.target[targetOffset] = options.source[sourceOffset] ?? 0;
	options.target[targetOffset + 1] = options.source[sourceOffset + 1] ?? 0;
	options.target[targetOffset + 2] = options.source[sourceOffset + 2] ?? 0;
}

function textureUseIdsForMaterialEntry(
	entry: StaticMaterialTableEntry,
): readonly string[] {
	return uniqueSortedStrings(
		[
			entry.primaryTextureUseId,
			entry.indexTextureUseId,
			entry.paletteTextureUseId,
			entry.detailTextureUseId,
		].filter((textureUseId): textureUseId is string => textureUseId !== null),
	);
}

function centerVec3OfBounds(bounds: StaticBounds) {
	return {
		x: (bounds.min.x + bounds.max.x) / 2,
		y: (bounds.min.y + bounds.max.y) / 2,
		z: (bounds.min.z + bounds.max.z) / 2,
	};
}

function dedupeStaticObjectVisualResources(
	resources: readonly StaticObjectVisualResource[],
): readonly StaticObjectVisualResource[] {
	const byKey = new Map<string, StaticObjectVisualResource>();
	for (const resource of resources) {
		byKey.set(
			createStaticObjectVisualResourceKeyString(resource.key),
			resource,
		);
	}
	return Array.from(byKey.values()).sort((left, right) =>
		left.resourceId.localeCompare(right.resourceId),
	);
}

function createDrawUnitSpatialRecord(
	drawUnitId: string,
	triangleCount: number,
): StaticSpatialRecord {
	return {
		drawUnitId,
		kind: "draw-unit-bounds",
		owner: {
			drawUnitId,
			kind: "draw-unit",
		},
		triangleCount,
	};
}

function warnAboutSkippedStaticObjectPartition(
	task: StaticBakeTask,
	payload: StaticObjectBatchPayload,
	partition: StaticObjectBatchPartition,
): void {
	console.warn(
		`browser skipped non-renderable static object partition ${partition.sliceId}.`,
		{
			domain: task.domain,
			landblockId: payload.landblock.landblockId,
			materialFamily: partition.family,
			materialPass: partition.pass,
			partitionId: partition.sliceId,
			reason: partition.reason,
			renderCoverage: partition.renderCoverage,
			triangleCount: partition.triangleCount,
			taskId: task.taskId,
		},
	);
}

interface StaticObjectGeometryBakeOutput {
	readonly drawUnit: StaticObjectGeometryStaticDrawUnit;
	readonly objectSpatialRecords: readonly StaticEnvCellStaticObjectSpatialRecord[];
}

function createStaticObjectGeometryBakeOutput(options: {
	readonly task: StaticBakeTask;
	readonly payload: StaticObjectBatchPayload;
	readonly partition: StaticObjectBatchPartition;
	readonly resourceIdPrefix: string;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): StaticObjectGeometryBakeOutput {
	const materialEntries = createStaticObjectMaterialTableEntries({
		partition: options.partition,
		textureUseScopeId: options.resourceIdPrefix,
	});
	const materialSlotByEntryKey = new Map<string, number>(
		options.partition.coarseTablePlan.entries.map((entry, index) => [
			entry.materialEntryKey,
			materialEntries[index]?.slot ?? index,
		]),
	);
	const geometry = bakeStaticObjectPartitionGeometry(
		options.partition.triangles,
		options.sourceIndex,
		materialSlotByEntryKey,
	);
	const textureUseIds = uniqueSortedStrings(
		materialEntries.flatMap((entry) =>
			[
				entry.primaryTextureUseId,
				entry.indexTextureUseId,
				entry.paletteTextureUseId,
				entry.detailTextureUseId,
			].filter((textureUseId): textureUseId is string => textureUseId !== null),
		),
	);
	const materialEntry = materialEntries[0];
	if (!materialEntry) {
		throw new Error(
			`Renderable static object partition ${options.partition.sliceId} has no material table entries.`,
		);
	}
	const drawUnitId = `${options.resourceIdPrefix}:static-object-partition:${options.partition.sliceId.replaceAll("/", "-")}`;

	const drawUnit: StaticObjectGeometryStaticDrawUnit = {
		coordinateSpace: "landblock-render-local",
		domain: options.payload.domain,
		drawUnitId,
		indexType: geometry.indices instanceof Uint16Array ? "uint16" : "uint32",
		indices: geometry.indices,
		kind: "static-object-geometry",
		landblockId: options.payload.landblock.landblockId,
		ownership: createStaticObjectDrawUnitOwnership(
			options.payload,
			options.partition,
		),
		materialBucketKey: options.partition.batchKey,
		materialEntries,
		materialFamily: resolveRenderableStaticObjectFamily(options.partition),
		materialIds: options.partition.materialIds,
		materialPass: resolveRenderableStaticObjectPass(options.partition),
		renderState: materialEntry.renderState,
		sort: createStaticObjectSortMetadata(options.partition, geometry.positions),
		positions: geometry.positions,
		sourceMappingCoverage: [],
		spatialRecord: null,
		texCoords: geometry.texCoords,
		materialSlotIndices: geometry.materialSlotIndices,
		textureUseIds,
		triangleCount: options.partition.triangleCount,
		vertexCount: options.partition.triangleCount * 3,
	};
	return {
		drawUnit,
		objectSpatialRecords: createEnvCellStaticObjectSpatialRecords({
			geometry,
			payload: options.payload,
			taskOwner: createLayerPeerRecordOwner(options.task),
		}),
	};
}

function createEnvCellStaticObjectSpatialRecords(options: {
	readonly geometry: ReturnType<typeof bakeStaticObjectPartitionGeometry>;
	readonly payload: StaticObjectBatchPayload;
	readonly taskOwner: StaticLayerPeerRecordOwner;
}): readonly StaticEnvCellStaticObjectSpatialRecord[] {
	if (options.payload.domain !== "env-cell-system") {
		return [];
	}

	const objectsByKey = new Map(
		options.payload.objects.map((object) => [
			createObjectKey(object.identity),
			object,
		]),
	);
	return [...options.geometry.objectBoundsByObjectKey].flatMap(
		([
			objectKey,
			bounds,
		]): readonly StaticEnvCellStaticObjectSpatialRecord[] => {
			const object = objectsByKey.get(objectKey);
			if (
				!object ||
				object.owningEnvCellId === null ||
				object.owningEnvCellId === undefined
			) {
				return [];
			}
			return [
				{
					bounds,
					envCellId: object.owningEnvCellId,
					instanceId: object.identity.instanceId,
					kind: "env-cell-static-object-bounds",
					landblockId: object.identity.landblockId,
					owner: options.taskOwner,
				},
			];
		},
	);
}

function createLayerPeerRecordOwner(
	task: StaticBakeTask,
): StaticLayerPeerRecordOwner {
	return createLayerPeerRecordOwnerForStaticBakeTask(task);
}

function createStaticObjectMaterialTableEntries(options: {
	readonly partition: StaticObjectBatchPartition;
	readonly textureUseScopeId: string;
}): readonly StaticMaterialTableEntry[] {
	return options.partition.coarseTablePlan.entries.map((entry, slot) =>
		createStaticMaterialTableEntry({
			createTextureUseId: (dataUse, wrapMode) =>
				createStaticObjectTextureUseId({
					dataUse,
					textureUseScopeId: options.textureUseScopeId,
					wrapMode,
				}),
			materialIds: entry.materialIds,
			plan: entry.materialPlan,
			slot,
			textureWrapMode: entry.textureWrapMode,
		}),
	);
}

function resolveRenderableStaticObjectFamily(
	partition: StaticObjectBatchPartition,
): StaticObjectGeometryStaticDrawUnit["materialFamily"] {
	if (
		partition.family === "flat-color" ||
		partition.family === "indexed-paletted" ||
		partition.family === "texture-rgba"
	) {
		return partition.family;
	}

	throw new Error(
		`Static object partition ${partition.sliceId} has unrenderable family ${partition.family}.`,
	);
}

function resolveRenderableStaticObjectPass(
	partition: StaticObjectBatchPartition,
): StaticObjectGeometryStaticDrawUnit["materialPass"] {
	if (
		partition.pass === "opaque" ||
		partition.pass === "alpha-test" ||
		partition.pass === "transparent" ||
		partition.pass === "additive"
	) {
		return partition.pass;
	}

	throw new Error(
		`Static object partition ${partition.sliceId} has unrenderable pass ${partition.pass}.`,
	);
}

function createStaticObjectSortMetadata(
	partition: StaticObjectBatchPartition,
	positions: Float32Array,
): StaticObjectSortMetadata {
	const bounds = computePositionBounds(positions);

	return {
		bounds,
		center: bounds ? centerOfBounds(bounds) : [0, 0, 0],
		objectPartKey: partition.partitionAxes.ownership.objectPartKey,
		policy:
			partition.partitionAxes.sort.policy === "transparent-object-part-sortable"
				? "object-part-back-to-front"
				: "depth-writing",
	};
}

function computePositionBounds(positions: Float32Array): StaticBounds | null {
	if (positions.length < 3) {
		return null;
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (let index = 0; index + 2 < positions.length; index += 3) {
		const x = positions[index]!;
		const y = positions[index + 1]!;
		const z = positions[index + 2]!;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		maxZ = Math.max(maxZ, z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function expandObjectBounds(
	boundsByObjectKey: Map<string, StaticBounds>,
	objectKey: string,
	positions: Float32Array,
	vertexIndex: number,
): void {
	const offset = vertexIndex * 3;
	const x = positions[offset]!;
	const y = positions[offset + 1]!;
	const z = positions[offset + 2]!;
	const existing = boundsByObjectKey.get(objectKey);
	if (!existing) {
		boundsByObjectKey.set(objectKey, {
			max: { x, y, z },
			min: { x, y, z },
		});
		return;
	}

	boundsByObjectKey.set(objectKey, {
		max: {
			x: Math.max(existing.max.x, x),
			y: Math.max(existing.max.y, y),
			z: Math.max(existing.max.z, z),
		},
		min: {
			x: Math.min(existing.min.x, x),
			y: Math.min(existing.min.y, y),
			z: Math.min(existing.min.z, z),
		},
	});
}

function centerOfBounds(
	bounds: StaticBounds,
): readonly [number, number, number] {
	return [
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	];
}

class StaticObjectBakeSourceIndex {
	readonly #objectsByKey = new Map<
		string,
		StaticObjectBatchPayload["objects"][number]
	>();
	readonly #sourcesByKey = new Map<
		string,
		StaticObjectBatchPayload["sourceAssets"][number]
	>();
	readonly #geometryByKey = new Map<
		string,
		StaticObjectSourceGeometryAttachment
	>();

	constructor(
		payload: StaticObjectBatchPayload,
		attachments: StaticBakeBatchInput["attachments"],
	) {
		for (const object of payload.objects) {
			this.#objectsByKey.set(createObjectKey(object.identity), object);
		}
		for (const source of payload.sourceAssets) {
			this.#sourcesByKey.set(createSourceKey(source.identity), source);
		}
		for (const geometry of attachments.staticObjectSourceGeometry) {
			this.#geometryByKey.set(
				describeStaticObjectCanonicalGeometryIdentity(geometry.identity),
				geometry,
			);
		}
	}

	getObject(
		identity: StaticObjectInstanceIdentity,
	): StaticObjectBatchPayload["objects"][number] {
		const object = this.#objectsByKey.get(createObjectKey(identity));
		if (!object) {
			throw new Error(
				`Static object geometry partition references missing object ${createObjectKey(identity)}.`,
			);
		}

		return object;
	}

	getPart(
		sourceIdentity: StaticObjectSourceIdentity,
		gfxIdentity: StaticObjectSourceIdentity,
		partIndex: number,
	): StaticObjectPartSourceFacts {
		const source = this.#sourcesByKey.get(createSourceKey(sourceIdentity));
		if (!source) {
			throw new Error(
				`Static object geometry partition references missing source ${createSourceKey(sourceIdentity)}.`,
			);
		}

		const part = source.parts.find(
			(candidate) =>
				candidate.partIndex === partIndex &&
				createSourceKey(candidate.gfxObj) === createSourceKey(gfxIdentity),
		);
		if (!part) {
			throw new Error(
				`Static object geometry partition references missing part ${createSourceKey(sourceIdentity)}:${createSourceKey(gfxIdentity)}:${partIndex}.`,
			);
		}

		return part;
	}

	getGeometry(
		part: StaticObjectPartSourceFacts,
	): StaticObjectSourceGeometryAttachment {
		const canonical = getStaticObjectCanonicalGeometryIdentity(part.geometry);
		const geometry = this.#geometryByKey.get(
			describeStaticObjectCanonicalGeometryIdentity(canonical),
		);
		if (!geometry) {
			throw new Error(
				`Static object geometry partition references missing geometry attachment ${describeStaticObjectCanonicalGeometryIdentity(
					canonical,
				)} for source part ${describeStaticObjectSourceGeometryIdentity(
					part.geometry,
				)}.`,
			);
		}

		return geometry;
	}
}

function bakeStaticObjectPartitionGeometry(
	triangles: readonly StaticObjectBatchTriangle[],
	sourceIndex: StaticObjectBakeSourceIndex,
	materialSlotByEntryKey: ReadonlyMap<string, number>,
): {
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly objectBoundsByObjectKey: ReadonlyMap<string, StaticBounds>;
} {
	const vertexCount = triangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const texCoords = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices = createIndexArray(vertexCount);
	const objectBoundsByObjectKey = new Map<string, StaticBounds>();

	for (const [triangleIndex, triangle] of triangles.entries()) {
		const object = sourceIndex.getObject(triangle.object);
		const objectKey = createObjectKey(object.identity);
		const part = sourceIndex.getPart(
			triangle.source,
			triangle.gfxObj,
			triangle.partIndex,
		);
		const sourceGeometry = sourceIndex.getGeometry(part);
		const sourceTriangle = findStaticObjectSourceTriangle(part, triangle);
		const materialSlot = materialSlotByEntryKey.get(triangle.materialEntryKey);
		if (materialSlot === undefined) {
			throw new Error(
				`Static object geometry partition references missing material entry ${triangle.materialEntryKey} for triangle ${triangle.sourceTriangleId}.`,
			);
		}

		const matrix = createStaticObjectSourcePartMatrix(object, part);
		for (let triangleVertex = 0; triangleVertex < 3; triangleVertex += 1) {
			const sourceVertexIndex = sourceTriangle.firstVertex + triangleVertex;
			const targetVertexIndex = triangleIndex * 3 + triangleVertex;
			writeTransformedPosition({
				matrix,
				positions,
				source: sourceGeometry.buffer.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			expandObjectBounds(
				objectBoundsByObjectKey,
				objectKey,
				positions,
				targetVertexIndex,
			);
			writeTexCoord({
				source: sourceGeometry.buffer.texCoords,
				sourceVertexIndex,
				target: texCoords,
				targetVertexIndex,
			});
			materialSlotIndices[targetVertexIndex] = materialSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		indices,
		materialSlotIndices,
		objectBoundsByObjectKey,
		positions,
		texCoords,
	};
}

function createStaticObjectBakeTextureUses(options: {
	readonly task: StaticBakeTask;
	readonly resourceIdPrefix: string;
	readonly bakeBatchId: string;
	readonly partitions: readonly StaticObjectBatchPartition[];
}): readonly StaticBakeTextureUse[] {
	return createStaticMaterialTextureUses({
		createTextureUseId: (dataUse, wrapMode) =>
			createStaticObjectTextureUseId({
				dataUse,
				textureUseScopeId: options.resourceIdPrefix,
				wrapMode,
			}),
		domain: options.task.domain,
		isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
		bakeBatchId: options.bakeBatchId,
		textureUseSpecs: options.partitions.flatMap((partition) => {
			if (partition.renderCoverage !== "classified-render-candidate") {
				return [];
			}
			const drawUnitOwnerId = `${options.resourceIdPrefix}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`;
			return partition.coarseTablePlan.entries.map((entry) => ({
				owners: [{ drawUnitId: drawUnitOwnerId, kind: "draw-unit" as const }],
				textureDataUses: entry.textureDataUses,
				textureWrapMode: entry.textureWrapMode,
			}));
		}),
	});
}

function createStaticObjectTextureUseId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticObjectBatchPartition["textureWrapMode"];
}): string {
	return createStaticMaterialTextureBindingRequirement({
		dataUse: options.dataUse,
		textureUseNamespace: "static-object-texture",
		textureUseScopeId: options.textureUseScopeId,
		wrapMode: options.wrapMode,
	}).bindingKey;
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
				owners: uniqueSortedStaticTextureUseOwners([
					...existing.owners,
					...textureUse.owners,
				]),
			});
			continue;
		}
		merged.set(textureUse.textureUseId, textureUse);
	}

	return [...merged.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createIndexArray(vertexCount: number): Uint16Array | Uint32Array {
	return vertexCount <= 0xffff
		? new Uint16Array(vertexCount)
		: new Uint32Array(vertexCount);
}

function createStaticObjectSourcePartMatrix(
	object: StaticObjectBatchPayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): Float32Array {
	let matrix = buildAcPlacementMatrix(object.localPlacement, AC_UNIT_SCALE);
	for (const placement of part.defaultPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(placement, AC_UNIT_SCALE),
		);
	}

	return multiplyMat4(
		matrix,
		createStaticObjectSourceScaleMatrix({
			x: object.sourceScale.x * part.scale.x,
			y: object.sourceScale.y * part.scale.y,
			z: object.sourceScale.z * part.scale.z,
		}),
	);
}

function createStaticObjectDrawUnitOwnership(
	payload: StaticObjectBatchPayload,
	partition: StaticObjectBatchPartition,
): StaticObjectDrawUnitOwnership {
	if (payload.domain !== "env-cell-system") {
		return {
			domain: payload.domain,
			kind: "outdoor-static-objects",
			landblockId: payload.landblock.landblockId,
		};
	}

	const identities = uniqueObjectIdentities(
		partition.triangles.map((triangle) => triangle.object),
	);
	const envCellIds = uniqueSortedNumbers(
		identities.map((identity) =>
			parseEnvCellIdFromStaticObjectInstance(identity),
		),
	);
	return {
		envCellIds,
		kind: "env-cell-static-object-placements",
		landblockId: payload.landblock.landblockId,
		seedIdentities: identities,
	};
}

function parseEnvCellIdFromStaticObjectInstance(
	identity: StaticObjectInstanceIdentity,
): number {
	const [envCellId] = identity.instanceId.split(":");
	if (!envCellId || !/^[0-9a-fA-F]{8}$/.test(envCellId)) {
		throw new Error(
			`Env-cell static object instance ${identity.instanceId} does not include an env-cell id prefix.`,
		);
	}

	return Number.parseInt(envCellId, 16) >>> 0;
}

function uniqueObjectIdentities(
	identities: readonly StaticObjectInstanceIdentity[],
): readonly StaticObjectInstanceIdentity[] {
	const byKey = new Map<string, StaticObjectInstanceIdentity>();
	for (const identity of identities) {
		byKey.set(createObjectKey(identity), identity);
	}
	return [...byKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, identity]) => identity);
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function createObjectKey(object: StaticObjectInstanceIdentity): string {
	return [
		formatHex32(object.landblockId),
		object.objectKind,
		object.instanceId,
	].join(":");
}

function createSourceKey(source: StaticObjectSourceIdentity): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function compareSourceMappingCoverage(
	left: StaticObjectSourceMappingCoverage,
	right: StaticObjectSourceMappingCoverage,
): number {
	return (
		createObjectKey(left.object).localeCompare(createObjectKey(right.object)) ||
		createSourceKey(left.source).localeCompare(createSourceKey(right.source)) ||
		createSourceKey(left.gfxObj).localeCompare(createSourceKey(right.gfxObj)) ||
		left.partIndex - right.partIndex ||
		left.materialSlot - right.materialSlot
	);
}

function compareNullableStrings(
	left: string | null,
	right: string | null,
): number {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return -1;
	}
	if (right === null) {
		return 1;
	}

	return left.localeCompare(right);
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
