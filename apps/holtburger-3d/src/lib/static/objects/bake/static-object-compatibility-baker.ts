import type {
	MaterialTextureDataUseIdentity,
	LandblockEnvCellsStaticScopePayload,
	ScheduledStaticWork,
	StaticBounds,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	OutdoorStaticObjectsScopePayload,
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
	StaticPortalApertureResource,
	StaticSpatialRecord,
	StaticWorkPeerRecordOwner,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticObjectSourceGeometryIdentity,
	StaticObjectInstanceFacts,
	StaticObjectRetainedTransparentPartitionReasonCounts,
	StaticObjectDynamicSeedClassificationReasonCounts,
} from "../../contracts";
import { uniqueSortedStaticTextureUseOwners } from "../../contracts";
import { describeStaticScopeKey } from "../../demand-planner";
import { createBuildingTransitionStaticPortalGraph } from "../../portal-graphs";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
	writeTexCoord,
	writeTransformedPosition,
} from "../../bake/ac-placement-transform";
import {
	createStaticMaterialTableEntry,
	createStaticMaterialTextureUses,
} from "../../bake/static-material-adapter";
import { createStaticMaterialTextureUseId } from "../../bake/static-material-texture-policy";
import { describeStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import {
	partitionStaticObjectCompatibility,
	type StaticObjectCompatibilityPayload,
	type StaticObjectCompatibilityPartition,
	type StaticObjectCompatibilityTriangle,
} from "./static-object-compatibility-partitioner";
import {
	isCurrentlyStageableStaticObjectDataUse,
	isRenderableStaticObjectPartition,
} from "./static-object-renderability";
import { deriveBuildingTransitionPortalApertureResource } from "./building-transition-portal-apertures";
import {
	createStaticObjectVisualResourceId,
	createStaticObjectVisualResourceKey,
	createStaticObjectVisualResourceKeyString,
} from "../static-object-visual-resource-key";

export class StaticObjectCompatibilityBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeStaticObjectCompatibility(input);
	}
}

export function bakeStaticObjectCompatibility(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (
		input.domain !== "outdoor-buildings" &&
		input.domain !== "outdoor-detail" &&
		input.domain !== "landblock-env-cells"
	) {
		throw new Error(
			`Static object compatibility baker only supports static object batches. Received ${input.domain}.`,
		);
	}

	const itemResults = input.items.map((item) =>
		bakeStaticObjectCompatibilityItem(input, item),
	);
	const drawUnits = itemResults.flatMap((result) => result.drawUnits);
	const buildingTransitionPortalApertureResources = itemResults.flatMap(
		(result) =>
			result.buildingTransitionPortalApertureResource
				? [result.buildingTransitionPortalApertureResource]
				: [],
	);

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		staticObjectRenderInstances: itemResults.flatMap(
			(result) => result.staticObjectRenderInstances,
		),
		staticObjectVisualResources: dedupeStaticObjectVisualResources(
			itemResults.flatMap((result) => result.staticObjectVisualResources),
		),
		staticObjectBakeDiagnostics: itemResults.map(
			(result) => result.diagnostics,
		),
		materialCoverage: itemResults.map((result) => result.materialCoverage),
		portalApertureResources: buildingTransitionPortalApertureResources,
		revision: input.revision,
		staticAuthoredDynamicSeeds: itemResults.flatMap(
			(result) => result.staticAuthoredDynamicSeeds,
		),
		staticBatchId: input.staticBatchId,
		staticPortalGraphs: itemResults.flatMap((result) =>
			result.buildingTransitionPortalApertureResource
				? [
						createBuildingTransitionStaticPortalGraph(
							createWorkPeerRecordOwner(result.work),
							result.buildingTransitionPortalApertureResource,
						),
					]
				: [],
		),
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
		works: input.items.map((item) => item.work),
	};
}

function createStaticObjectSourceMappingCoverage(
	partition: StaticObjectCompatibilityPartition,
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

function bakeStaticObjectCompatibilityItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticBakeBatchResult["materialCoverage"][number];
	readonly diagnostics: StaticObjectBakeDiagnostics;
	readonly sourceMappings: StaticBakeBatchResult["staticSourceMappings"];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
	readonly staticAuthoredDynamicSeeds: StaticBakeBatchResult["staticAuthoredDynamicSeeds"];
	readonly buildingTransitionPortalApertureResource: StaticPortalApertureResource | null;
	readonly work: StaticBakeBatchItem["work"];
} {
	const scope = createStaticObjectCompatibilityPayload(item);
	const buildingTransitionPortalApertureResource =
		item.payload.scope.kind === "outdoor-static-objects"
			? deriveBuildingTransitionPortalApertureResource(item.payload.scope)
			: null;
	const partitionPlan = partitionStaticObjectCompatibility(scope);
	const sourceIndex = new StaticObjectBakeSourceIndex(scope, input.attachments);
	const renderablePartitions = partitionPlan.partitions.filter((partition) => {
		if (isRenderableStaticObjectPartition(partition)) {
			return true;
		}

		warnAboutSkippedStaticObjectPartition(item.work, scope, partition);
		return false;
	});
	const instancedOutput = createStaticObjectInstancedOutput({
		partitions: renderablePartitions,
		payload: scope,
		sourceIndex,
		staticBatchId: input.staticBatchId,
		work: item.work,
	});
	const bakedPartitions = renderablePartitions.filter(
		(partition) =>
			!instancedOutput.cutoverPartitionSliceIds.has(partition.sliceId),
	);
	const drawUnits = bakedPartitions.map((partition) =>
		createStaticObjectGeometryBakeOutput({
			partition,
			payload: scope,
			sourceIndex,
			work: item.work,
		}),
	);
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

	return {
		drawUnits: bakedDrawUnits,
		diagnostics: createStaticObjectBakeDiagnostics({
			authoredDynamicSeeds: getOutdoorAuthoredDynamicSeeds(item.payload.scope),
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
		staticAuthoredDynamicSeeds: createOutdoorAuthoredDynamicSeedRecords(
			item.work,
			item.payload.scope,
		),
		staticObjectRenderInstances: instancedOutput.instances,
		staticObjectVisualResources: instancedOutput.resources,
		textureUses: createStaticObjectBakeTextureUses({
			partitions: bakedPartitions,
			staticBatchId: input.staticBatchId,
			work: item.work,
		}).concat(instancedOutput.textureUses),
		buildingTransitionPortalApertureResource,
		work: item.work,
	};
}

function createStaticObjectBakeDiagnostics(options: {
	readonly input: StaticBakeBatchInput;
	readonly authoredDynamicSeeds: readonly OutdoorStaticObjectsScopePayload["authoredDynamicSeeds"][number][];
	readonly instancedOutput: {
		readonly instances: readonly StaticObjectRenderInstance[];
		readonly resources: readonly StaticObjectVisualResource[];
	};
	readonly payload: StaticObjectCompatibilityPayload;
	readonly partitionPlan: ReturnType<typeof partitionStaticObjectCompatibility>;
	readonly retainedBakedPartitions: readonly StaticObjectCompatibilityPartition[];
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
		authoredDynamicSeedCount: options.authoredDynamicSeeds.length,
		authoredDynamicSeedClassificationReasons:
			createStaticObjectDynamicSeedClassificationReasonCounts(
				options.authoredDynamicSeeds,
			),
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
		retainedTransparentOutdoorDetailPartitionReasons:
			createRetainedTransparentOutdoorDetailPartitionReasons({
				partitions: options.retainedBakedPartitions,
				payload: options.payload,
				sourceIndex: options.sourceIndex,
			}),
		skippedPartitionCount:
			options.partitionPlan.partitions.length -
			options.renderablePartitionCount,
		staticBatchId: options.input.staticBatchId,
		uniqueSourceCount: uniqueSourceKeys.size,
		uniqueSourcePartGeometryCount: uniqueSourcePartGeometryKeys.size,
		uniqueSourceTriangleCount,
	};
}

function createOutdoorAuthoredDynamicSeedRecords(
	work: StaticBakeBatchItem["work"],
	payload: StaticBakeBatchItem["payload"]["scope"],
): StaticBakeBatchResult["staticAuthoredDynamicSeeds"] {
	if (payload.kind !== "outdoor-static-objects") {
		return [];
	}
	const owner = createWorkPeerRecordOwner(work);
	return payload.authoredDynamicSeeds.map((seed) => ({
		kind: "outdoor-static-object-dynamic-seed",
		owner,
		seed,
	}));
}

function getOutdoorAuthoredDynamicSeeds(
	payload: StaticBakeBatchItem["payload"]["scope"],
): readonly OutdoorStaticObjectsScopePayload["authoredDynamicSeeds"][number][] {
	return payload.kind === "outdoor-static-objects"
		? payload.authoredDynamicSeeds
		: [];
}

function createStaticObjectDynamicSeedClassificationReasonCounts(
	seeds: readonly OutdoorStaticObjectsScopePayload["authoredDynamicSeeds"][number][],
): StaticObjectDynamicSeedClassificationReasonCounts {
	return {
		setupDefaultAnimation: seeds.filter(
			(seed) => seed.classificationReason === "setup-default-animation",
		).length,
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

function createRetainedTransparentOutdoorDetailPartitionReasons(options: {
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
	readonly payload: StaticObjectCompatibilityPayload;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): StaticObjectRetainedTransparentPartitionReasonCounts {
	const counts = createEmptyRetainedTransparentPartitionReasonCounts();
	if (options.payload.domain !== "outdoor-detail") {
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
	partitions: readonly StaticObjectCompatibilityPartition[],
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
	readonly partition: StaticObjectCompatibilityPartition;
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
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
	readonly payload: StaticObjectCompatibilityPayload;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
	readonly staticBatchId: string;
	readonly work: ScheduledStaticWork;
}): {
	readonly cutoverPartitionSliceIds: ReadonlySet<string>;
	readonly instances: readonly StaticObjectRenderInstance[];
	readonly resources: readonly StaticObjectVisualResource[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (options.payload.domain !== "outdoor-detail") {
		return {
			cutoverPartitionSliceIds: new Set<string>(),
			instances: [],
			resources: [],
			textureUses: [],
		};
	}

	const groupsByKey = new Map<
		string,
		StaticObjectVisualResourceTriangleGroup
	>();
	const triangleCoverageKeysByPartitionSliceId = new Map<string, Set<string>>();
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
			work: options.work,
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
			const object = options.sourceIndex.getObject(triangle.object);
			const candidate =
				selectGeneratedStaticObjectRenderInstanceCandidate(object);
			if (candidate.kind === "ineligible") {
				continue;
			}
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

	const resources: StaticObjectVisualResource[] = [];
	const instances: StaticObjectRenderInstance[] = [];
	const textureUses: StaticBakeTextureUse[] = [];
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
						work: options.work,
						wrapMode,
					}),
				domain: options.payload.domain,
				isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
				staticBatchId: options.staticBatchId,
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
			group.geometry.gfxObj,
			group.geometry.partIndex,
		);
		for (const candidate of cutoverCandidates) {
			instances.push({
				bounds: candidate.bounds,
				domain: "outdoor-detail",
				generated: candidate.generated,
				instanceId: [
					"static-object-render-instance",
					candidate.object.identity.instanceId,
					`part:${group.geometry.partIndex}`,
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
	readonly sourceTrianglesById: Map<string, StaticObjectCompatibilityTriangle>;
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly textureUseIds: readonly string[];
	readonly textureWrapMode: StaticObjectCompatibilityPartition["textureWrapMode"];
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
	partition: StaticObjectCompatibilityPartition,
	triangle: StaticObjectCompatibilityTriangle,
): string {
	return [
		partition.sliceId,
		createObjectKey(triangle.object),
		triangle.sourceTriangleId,
		triangle.materialEntryKey,
	].join("|");
}

function createStaticObjectSourceLocalTriangleKey(
	triangle: StaticObjectCompatibilityTriangle,
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
	readonly triangles: readonly StaticObjectCompatibilityTriangle[];
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
				source: sourceGeometry.positions,
				sourceVertexIndex,
				target: positions,
				targetVertexIndex,
			});
			writeTexCoord({
				source: sourceGeometry.texCoords,
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
	triangle: StaticObjectCompatibilityTriangle,
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

function createStaticObjectCompatibilityPayload(
	item: StaticBakeBatchItem,
): StaticObjectCompatibilityPayload {
	if (
		(item.work.job.domain === "outdoor-buildings" ||
			item.work.job.domain === "outdoor-detail") &&
		item.payload.scope.kind === "outdoor-static-objects"
	) {
		return item.payload.scope;
	}
	if (
		item.work.job.domain === "landblock-env-cells" &&
		item.payload.scope.kind === "landblock-env-cells"
	) {
		return createEnvCellStaticObjectCompatibilityPayload(item.payload.scope);
	}

	throw new Error(
		`Static object compatibility baker only supports static object payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
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
	work: ScheduledStaticWork,
	payload: StaticObjectCompatibilityPayload,
	partition: StaticObjectCompatibilityPartition,
): void {
	console.warn(
		`browser skipped non-renderable static object partition ${partition.sliceId}.`,
		{
			domain: work.job.domain,
			landblockId: payload.landblock.landblockId,
			materialFamily: partition.family,
			materialPass: partition.pass,
			partitionId: partition.sliceId,
			reason: partition.reason,
			renderCoverage: partition.renderCoverage,
			triangleCount: partition.triangleCount,
			workId: work.workId,
		},
	);
}

interface StaticObjectGeometryBakeOutput {
	readonly drawUnit: StaticObjectGeometryStaticDrawUnit;
	readonly objectSpatialRecords: readonly StaticEnvCellStaticObjectSpatialRecord[];
}

function createStaticObjectGeometryBakeOutput(options: {
	readonly work: ScheduledStaticWork;
	readonly payload: StaticObjectCompatibilityPayload;
	readonly partition: StaticObjectCompatibilityPartition;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): StaticObjectGeometryBakeOutput {
	const materialEntries = createStaticObjectMaterialTableEntries(options);
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
	const drawUnitId = `${options.work.workId}:static-object-partition:${options.partition.sliceId.replaceAll("/", "-")}`;

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
		materialBucketKey: options.partition.compatibilityKey,
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
			workOwner: createWorkPeerRecordOwner(options.work),
		}),
	};
}

function createEnvCellStaticObjectSpatialRecords(options: {
	readonly geometry: ReturnType<typeof bakeStaticObjectPartitionGeometry>;
	readonly payload: StaticObjectCompatibilityPayload;
	readonly workOwner: StaticWorkPeerRecordOwner;
}): readonly StaticEnvCellStaticObjectSpatialRecord[] {
	if (options.payload.domain !== "landblock-env-cells") {
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
					owner: options.workOwner,
				},
			];
		},
	);
}

function createWorkPeerRecordOwner(
	work: ScheduledStaticWork,
): StaticWorkPeerRecordOwner {
	return {
		domain: work.job.domain,
		kind: "work",
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
		workId: work.workId,
	};
}

function createStaticObjectMaterialTableEntries(options: {
	readonly work: ScheduledStaticWork;
	readonly partition: StaticObjectCompatibilityPartition;
}): readonly StaticMaterialTableEntry[] {
	return options.partition.coarseTablePlan.entries.map((entry, slot) =>
		createStaticMaterialTableEntry({
			createTextureUseId: (dataUse, wrapMode) =>
				createStaticObjectTextureUseId({
					dataUse,
					work: options.work,
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
	partition: StaticObjectCompatibilityPartition,
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
	partition: StaticObjectCompatibilityPartition,
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
	partition: StaticObjectCompatibilityPartition,
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
		StaticObjectCompatibilityPayload["objects"][number]
	>();
	readonly #sourcesByKey = new Map<
		string,
		StaticObjectCompatibilityPayload["sourceAssets"][number]
	>();
	readonly #geometryByKey = new Map<
		string,
		StaticObjectSourceGeometryAttachment
	>();

	constructor(
		payload: StaticObjectCompatibilityPayload,
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
				describeStaticObjectSourceGeometryIdentity(geometry.identity),
				geometry,
			);
		}
	}

	getObject(
		identity: StaticObjectInstanceIdentity,
	): StaticObjectCompatibilityPayload["objects"][number] {
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
		const geometry = this.#geometryByKey.get(
			describeStaticObjectSourceGeometryIdentity(part.geometry),
		);
		if (!geometry) {
			throw new Error(
				`Static object geometry partition references missing geometry attachment ${describeStaticObjectSourceGeometryIdentity(
					part.geometry,
				)}.`,
			);
		}

		return geometry;
	}
}

function bakeStaticObjectPartitionGeometry(
	triangles: readonly StaticObjectCompatibilityTriangle[],
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
				source: sourceGeometry.positions,
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
				source: sourceGeometry.texCoords,
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
	readonly work: ScheduledStaticWork;
	readonly staticBatchId: string;
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
}): readonly StaticBakeTextureUse[] {
	return createStaticMaterialTextureUses({
		createTextureUseId: (dataUse, wrapMode) =>
			createStaticObjectTextureUseId({
				dataUse,
				work: options.work,
				wrapMode,
			}),
		domain: options.work.job.domain,
		isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
		staticBatchId: options.staticBatchId,
		textureUseSpecs: options.partitions.flatMap((partition) => {
			if (partition.renderCoverage !== "classified-render-candidate") {
				return [];
			}
			const drawUnitOwnerId = `${options.work.workId}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`;
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
	readonly work: ScheduledStaticWork;
	readonly wrapMode: StaticObjectCompatibilityPartition["textureWrapMode"];
}): string {
	return createStaticMaterialTextureUseId({
		dataUse: options.dataUse,
		textureUseNamespace: "static-object-texture",
		workId: options.work.workId,
		wrapMode: options.wrapMode,
	});
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
	object: StaticObjectCompatibilityPayload["objects"][number],
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

function createEnvCellStaticObjectCompatibilityPayload(
	payload: LandblockEnvCellsStaticScopePayload,
): StaticObjectCompatibilityPayload {
	const sourceByKey = new Set(
		(payload.sourceAssets ?? []).map((source) =>
			createSourceKey(source.identity),
		),
	);
	const objects = payload.envCells.flatMap((envCell) =>
		envCell.staticObjectSeeds.flatMap((seed) => {
			if (!sourceByKey.has(createSourceKey(seed.source))) {
				return [];
			}
			return {
				debug: seed.debug,
				generated: null,
				identity: seed.identity,
				instanceBounds: null,
				localPlacement: seed.localPlacement,
				owningEnvCellId: envCell.identity.envCellId,
				portalCount: 0,
				source: seed.source,
				sourceBounds: null,
				sourceIndex: seed.sourceIndex,
				sourceScale: seed.sourceScale ?? { x: 1, y: 1, z: 1 },
			};
		}),
	);

	return {
		domain: "landblock-env-cells",
		landblock: payload.landblock,
		materialSlots: [],
		materialSources: payload.materialSources ?? [],
		objects,
		paletteSources: payload.paletteSources ?? [],
		regionRenderProfile: { detailRoles: [] },
		sourceAssets: payload.sourceAssets ?? [],
		textureRefs: payload.textureRefs ?? [],
	};
}

function createStaticObjectDrawUnitOwnership(
	payload: StaticObjectCompatibilityPayload,
	partition: StaticObjectCompatibilityPartition,
): StaticObjectDrawUnitOwnership {
	if (payload.domain !== "landblock-env-cells") {
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
		kind: "env-cell-static-object-seeds",
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
