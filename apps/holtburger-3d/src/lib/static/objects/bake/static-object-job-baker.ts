import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTask,
	StaticBounds,
	StaticBakeJobInput,
	StaticBakeJobPayload,
	StaticBakeJobResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectDrawUnitOwnership,
	StaticObjectBakeDiagnostics,
	StaticMaterialTableEntry,
	StaticObjectInstanceIdentity,
	StaticEnvCellStaticObjectSpatialRecord,
	StaticObjectSourceGeometrySidecar,
	StaticObjectPartSourceFacts,
	StaticObjectSourceMappingCoverage,
	StaticObjectSortMetadata,
	StaticObjectSourceIdentity,
	StaticSpatialRecord,
	StaticLayerPeerRecordOwner,
	StaticObjectInstanceFacts,
	StaticObjectRetainedTransparentPartitionReasonCounts,
} from "../../contracts";
import { uniqueSortedStaticTextureUseOwners } from "../../contracts";
import type { TextureResourceDependencies } from "../../../textures/placement";
import type { TextureBindingId } from "../../../textures/identity";
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
import { createStaticMaterialTableEntry } from "../../bake/static-material-adapter";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import { emitStaticBakeWorkerTrace } from "../../bake/worker-trace";
import { createStaticObjectVisualRecipeInstallPublication } from "../../bake/object-visual-recipe-install-publication";
import {
	describeStaticObjectCanonicalGeometryIdentity,
	describeStaticObjectSourceGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static-object-source-assets";
import {
	partitionStaticObjectBatches,
	type StaticObjectBatchPartition,
	type StaticObjectBatchTriangle,
} from "./static-object-batch-partitioner";
import { isRenderableStaticObjectPartition } from "./static-object-renderability";
import { createObjectVisualResourceKeyString } from "../../../visual/object-visual-resource-key";
import { createObjectVisualSourcePayload } from "./object-visual-source-payload";
import {
	createObjectVisualInstallSet,
	type ObjectVisualRenderInstance,
	type ObjectVisualResource,
} from "../../../visual/object-visual-install-set";
import { createObjectVisualSourceBundleExpansion } from "../../../visual/object-visual-source-bundle-producer";
import { createStaticObjectPublicationMetadata } from "./static-object-publication-metadata-producer";
import type { ObjectVisualSourcePayload } from "../../../visual/object-visual-source-payload";

export class StaticObjectJobBaker implements StaticBaker {
	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return bakeStaticObjectJob(input);
	}
}

export function bakeStaticObjectJob(
	input: StaticBakeJobInput,
): StaticBakeJobResult {
	if (
		input.domain !== "outdoor-buildings" &&
		input.domain !== "outdoor-explicit-objects" &&
		input.domain !== "outdoor-generated-scenery" &&
		input.domain !== "env-cell-system"
	) {
		throw new Error(
			`Static object baker only supports static object jobs. Received ${input.domain}.`,
		);
	}

	const item = { payload: input.payload, task: input.task };
	emitStaticBakeWorkerTrace("static-object-job:start", {
		domain: input.domain,
		revision: input.revision,
		taskId: input.task.taskId,
	});
	const itemResult = bakeStaticObjectJobPayload(input, item, 0);
	const textureDependencies = itemResult.textureDependencies;
	const objectVisualTextureDependencies =
		itemResult.objectVisualTextureDependencies;
	const objectVisualInstallSet = createObjectVisualInstallSet({
		directDrawUnits: itemResult.objectVisualInstallSet.directDrawUnits,
		dynamicAnimationPartBindings:
			itemResult.objectVisualInstallSet.dynamicAnimationPartBindings,
		renderInstances: itemResult.objectVisualInstallSet.renderInstances,
		textureDependencies: objectVisualTextureDependencies,
		visualResources: dedupeObjectVisualResources(
			itemResult.objectVisualInstallSet.visualResources,
		),
	});
	emitStaticBakeWorkerTrace("static-object-job:end", {
		domain: input.domain,
		drawUnitCount: objectVisualInstallSet.directDrawUnits.length,
		taskId: input.task.taskId,
	});

	return {
		atlasRegistryUpdates: [],
		buildRevision: input.payload.sourceRevision,
		domain: input.domain,
		drawUnits: [],
		staticObjectBakeDiagnostics: [itemResult.diagnostics],
		materialCoverage: [itemResult.materialCoverage],
		objectVisualInstallSet,
		portalApertureResources: [],
		revision: input.revision,
		envCellStaticObjectPlacementRecords: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: itemResult.sourceMappings,
		staticSpatialRecords: itemResult.spatialRecords,
		staticVisibilityRecords: [],
		textureUses: mergeTextureUses(itemResult.textureUses),
		textureDependencies,
		task: input.task,
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

function bakeStaticObjectJobPayload(
	input: StaticBakeJobInput,
	item: StaticBakeJobPayload,
	itemIndex: number,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticBakeJobResult["materialCoverage"][number];
	readonly diagnostics: StaticObjectBakeDiagnostics;
	readonly sourceMappings: StaticBakeJobResult["staticSourceMappings"];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly objectVisualInstallSet: ReturnType<
		typeof createObjectVisualInstallSet
	>;
	readonly objectVisualTextureDependencies: readonly TextureResourceDependencies[];
	readonly task: StaticBakeJobPayload["task"];
} {
	emitStaticBakeWorkerTrace("static-object-item:start", {
		domain: item.task.domain,
		itemIndex,
		ownerId: item.task.ownerId,
		scopeKey: item.task.scopeKey,
	});
	const scope = createObjectVisualSourcePayload(item);
	emitStaticBakeWorkerTrace("static-object-item:payload", {
		domain: scope.domain,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		objectCount: scope.objects.length,
		sourceAssetCount: scope.sourceAssets.length,
		textureRefCount: scope.textureRefs.length,
	});
	const sourceIndex = new StaticObjectBakeSourceIndex(scope, input.resources);
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
	const bakedPartitions = renderablePartitions;
	const drawUnits = bakedPartitions.map((partition) =>
		createStaticObjectGeometryBakeOutput({
			partition,
			payload: scope,
			resourceIdPrefix,
			sourceIndex,
			task: item.task,
		}),
	);
	const recipePublication = createStaticObjectRecipePublication({
		input,
		payload: scope,
		resourceIdPrefix,
		task: item.task,
	});
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
	emitStaticBakeWorkerTrace("static-object-item:end", {
		domain: scope.domain,
		drawUnitCount: bakedDrawUnits.length,
		itemIndex,
		landblockId: formatHex32(scope.landblock.landblockId),
		textureUseCount: recipePublication.textureUses.length,
	});

	return {
		drawUnits: [],
		diagnostics: createStaticObjectBakeDiagnostics({
			drawUnits: drawUnits.map((output) => output.drawUnit),
			input,
			instancedOutput: {
				instances: recipePublication.installSet.renderInstances,
				resources: recipePublication.installSet.visualResources,
			},
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
		textureDependencies: [],
		textureUses: recipePublication.textureUses,
		objectVisualInstallSet: recipePublication.installSet,
		objectVisualTextureDependencies: recipePublication.textureDependencies,
		task: item.task,
	};
}

function createStaticObjectRecipePublication(options: {
	readonly input: StaticBakeJobInput;
	readonly payload: ObjectVisualSourcePayload;
	readonly resourceIdPrefix: string;
	readonly task: StaticBakeTask;
}): {
	readonly installSet: ReturnType<typeof createObjectVisualInstallSet>;
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	const expansion = createObjectVisualSourceBundleExpansion({
		geometrySidecars: options.input.resources,
		payload: options.payload,
	});
	if (expansion.resolution.kind === "missing-dependencies") {
		console.warn(
			`Skipped static object visual recipe publication for ${options.task.ownerId}; missing ${expansion.resolution.missingDependencies
				.map((dependency) => dependency.sourceId)
				.join(", ")}.`,
		);
		return {
			installSet: createObjectVisualInstallSet({}),
			textureDependencies: [],
			textureUses: [],
		};
	}
	if (expansion.resolution.bundle.partInstances.length === 0) {
		console.warn(
			`Skipped static object visual recipe publication for ${options.task.ownerId}; no visual part instances were resolved.`,
		);
		return {
			installSet: createObjectVisualInstallSet({}),
			textureDependencies: [],
			textureUses: [],
		};
	}

	const publication = createStaticObjectPublicationMetadata({
		owner: createLayerPeerRecordOwner(options.task),
		payload: options.payload,
	});
	return createStaticObjectVisualRecipeInstallPublication({
		bundle: expansion.resolution.bundle,
		domain: options.task.domain,
		geometryBuffers: expansion.geometryBuffers,
		metadata: publication.metadata,
		renderPartIdPrefix: `${options.resourceIdPrefix}:object-visual`,
		texturePlacementSnapshot: requireObjectVisualTexturePlacementSnapshot(
			options.input.texturePlacementSnapshot,
			"Static object visual recipe publication",
		),
		textureUseNamespace: "static-object-texture",
		textureUseScopeId: options.resourceIdPrefix,
	});
}

function createStaticObjectBakeDiagnostics(options: {
	readonly input: StaticBakeJobInput;
	readonly instancedOutput: {
		readonly instances: readonly ObjectVisualRenderInstance[];
		readonly resources: readonly ObjectVisualResource[];
	};
	readonly payload: ObjectVisualSourcePayload;
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

	const instancingDiagnostics = createStaticObjectInstancingBakeDiagnostics(
		options.instancedOutput,
	);

	return {
		buildingObjectCount: options.payload.objects.filter(
			(object) => object.identity.objectKind === "building",
		).length,
		domain: options.payload.domain,
		drawUnitCount: options.drawUnits.length,
		explicitObjectCount: options.payload.objects.filter(
			(object) => object.identity.objectKind === "explicit-object",
		).length,
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
		taskId: options.input.task.taskId,
		uniqueSourceCount: uniqueSourceKeys.size,
		uniqueSourcePartGeometryCount: uniqueSourcePartGeometryKeys.size,
		uniqueSourceTriangleCount,
	};
}

function createStaticObjectInstancingBakeDiagnostics(input: {
	readonly instances: readonly ObjectVisualRenderInstance[];
	readonly resources: readonly ObjectVisualResource[];
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
		const resourceBytes = estimateObjectVisualResourceTypedArrayBytes(resource);
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
	readonly payload: ObjectVisualSourcePayload;
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
		const candidate = selectGeneratedObjectVisualRenderInstanceCandidate(
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

function estimateObjectVisualResourceTypedArrayBytes(
	resource: ObjectVisualResource,
): number {
	return (
		resource.positions.byteLength +
		resource.texCoords.byteLength +
		resource.materialSlotIndices.byteLength +
		resource.indices.byteLength
	);
}

type GeneratedObjectVisualRenderInstanceCandidateEligibility =
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

function selectGeneratedObjectVisualRenderInstanceCandidate(
	object: StaticObjectInstanceFacts | undefined,
): GeneratedObjectVisualRenderInstanceCandidateEligibility {
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
			`Static object geometry references missing source triangle ${triangle.sourceTriangleId}.`,
		);
	}

	return sourceTriangle;
}

function dedupeObjectVisualResources(
	resources: readonly ObjectVisualResource[],
): readonly ObjectVisualResource[] {
	const byKey = new Map<string, ObjectVisualResource>();
	for (const resource of resources) {
		byKey.set(createObjectVisualResourceKeyString(resource.key), resource);
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
	payload: ObjectVisualSourcePayload,
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
	readonly payload: ObjectVisualSourcePayload;
	readonly partition: StaticObjectBatchPartition;
	readonly resourceIdPrefix: string;
	readonly sourceIndex: StaticObjectBakeSourceIndex;
}): StaticObjectGeometryBakeOutput {
	const materialEntries = createStaticObjectMaterialTableEntries({
		domain: options.task.domain,
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
	const textureBindingIds = uniqueSortedStrings(
		materialEntries.flatMap((entry) =>
			[
				entry.primaryTextureBindingId,
				entry.indexTextureBindingId,
				entry.paletteTextureBindingId,
				entry.detailTextureBindingId,
			].filter(
				(textureBindingId): textureBindingId is TextureBindingId =>
					textureBindingId !== null,
			),
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
		textureBindingIds,
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
	readonly payload: ObjectVisualSourcePayload;
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
	readonly domain: StaticBakeTask["domain"];
	readonly partition: StaticObjectBatchPartition;
	readonly textureUseScopeId: string;
}): readonly StaticMaterialTableEntry[] {
	return options.partition.coarseTablePlan.entries.map((entry, slot) =>
		createStaticMaterialTableEntry({
			createTextureUseId: (dataUse, wrapMode) =>
				createStaticObjectTextureBindingReference({
					dataUse,
					domain: options.domain,
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
		ObjectVisualSourcePayload["objects"][number]
	>();
	readonly #sourcesByKey = new Map<
		string,
		ObjectVisualSourcePayload["sourceAssets"][number]
	>();
	readonly #geometryByKey = new Map<
		string,
		StaticObjectSourceGeometrySidecar
	>();

	constructor(
		payload: ObjectVisualSourcePayload,
		resources: StaticBakeJobInput["resources"],
	) {
		for (const object of payload.objects) {
			this.#objectsByKey.set(createObjectKey(object.identity), object);
		}
		for (const source of payload.sourceAssets) {
			this.#sourcesByKey.set(createSourceKey(source.identity), source);
		}
		for (const geometry of resources.staticObjectSourceGeometry) {
			this.#geometryByKey.set(
				describeStaticObjectCanonicalGeometryIdentity(geometry.identity),
				geometry,
			);
		}
	}

	getObject(
		identity: StaticObjectInstanceIdentity,
	): ObjectVisualSourcePayload["objects"][number] {
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
	): StaticObjectSourceGeometrySidecar {
		const canonical = getStaticObjectCanonicalGeometryIdentity(part.geometry);
		const geometry = this.#geometryByKey.get(
			describeStaticObjectCanonicalGeometryIdentity(canonical),
		);
		if (!geometry) {
			throw new Error(
				`Static object geometry partition references missing geometry sidecar ${describeStaticObjectCanonicalGeometryIdentity(
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

function createStaticObjectTextureBindingReference(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly domain: StaticBakeTask["domain"];
	readonly textureUseScopeId: string;
	readonly wrapMode: StaticObjectBatchPartition["textureWrapMode"];
}): { readonly bindingId: TextureBindingId; readonly textureKey: string } {
	const requirement = createStaticMaterialTextureBindingRequirement({
		dataUse: options.dataUse,
		domain: options.domain,
		textureUseNamespace: "static-object-texture",
		textureUseScopeId: options.textureUseScopeId,
		wrapMode: options.wrapMode,
	});
	return {
		bindingId: requirement.bindingId,
		textureKey: requirement.sourceKey,
	};
}

function mergeTextureUses(
	textureUses: readonly StaticBakeTextureUse[],
): readonly StaticBakeTextureUse[] {
	const merged = new Map<TextureBindingId, StaticBakeTextureUse>();

	for (const textureUse of textureUses) {
		const existing = merged.get(textureUse.bindingId);
		if (existing) {
			merged.set(textureUse.bindingId, {
				...existing,
				owners: uniqueSortedStaticTextureUseOwners([
					...existing.owners,
					...textureUse.owners,
				]),
			});
			continue;
		}
		merged.set(textureUse.bindingId, textureUse);
	}

	return [...merged.values()].sort((left, right) =>
		left.bindingId.localeCompare(right.bindingId),
	);
}

function uniqueSortedStrings<T extends string>(values: readonly T[]): readonly T[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createIndexArray(vertexCount: number): Uint16Array | Uint32Array {
	return vertexCount <= 0xffff
		? new Uint16Array(vertexCount)
		: new Uint32Array(vertexCount);
}

function createStaticObjectSourcePartMatrix(
	object: ObjectVisualSourcePayload["objects"][number],
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
	payload: ObjectVisualSourcePayload,
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
