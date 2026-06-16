import type {
	MaterialTextureDataUseIdentity,
	LandblockEnvCellsStaticScopePayload,
	ScheduledStaticWork,
	StaticBounds,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureSamplingPolicy,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectDrawUnitOwnership,
	StaticObjectMaterialTableEntry,
	StaticObjectInstanceIdentity,
	StaticEnvCellStaticObjectSpatialRecord,
	StaticObjectSourceGeometryAttachment,
	StaticObjectPartSourceFacts,
	StaticObjectRenderState,
	StaticObjectSourceMappingCoverage,
	StaticObjectSortMetadata,
	StaticObjectSourceIdentity,
	StaticSpatialRecord,
} from "../../contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
	writeTexCoord,
	writeTransformedPosition,
} from "../../bake/ac-placement-transform";
import { describeStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import {
	createMaterialTextureDataUseKey,
	partitionStaticObjectCompatibility,
	type StaticObjectCompatibilityPayload,
	type StaticObjectCompatibilityPartition,
	type StaticObjectCompatibilityTriangle,
} from "./static-object-compatibility-partitioner";
import {
	isCurrentlyStageableStaticObjectDataUse,
	isRenderableStaticObjectPartition,
} from "./static-object-renderability";

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

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		materialCoverage: itemResults.map((result) => result.materialCoverage),
		revision: input.revision,
		staticAuthoredDynamicSeeds: [],
		staticBatchId: input.staticBatchId,
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
	readonly sourceMappings: StaticBakeBatchResult["staticSourceMappings"];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	const scope = createStaticObjectCompatibilityPayload(item);
	const partitionPlan = partitionStaticObjectCompatibility(scope);
	const renderablePartitions = partitionPlan.partitions.filter((partition) => {
		if (isRenderableStaticObjectPartition(partition)) {
			return true;
		}

		warnAboutSkippedStaticObjectPartition(item.work, scope, partition);
		return false;
	});
	const drawUnits = renderablePartitions.map((partition) =>
		createStaticObjectGeometryBakeOutput({
			attachments: input.attachments,
			partition,
			payload: scope,
			work: item.work,
		}),
	);
	const drawUnitIdBySliceId = new Map(
		renderablePartitions.map((partition, index) => [
			partition.sliceId,
			drawUnits[index]?.drawUnit.drawUnitId ?? "",
		]),
	);
	const sourceMappingCoverageBySliceId = new Map(
		renderablePartitions.map(
			(partition) =>
				[
					partition.sliceId,
					createStaticObjectSourceMappingCoverage(partition),
				] as const,
		),
	);
	const spatialRecordBySliceId = new Map(
		renderablePartitions.map((partition) => {
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

	return {
		drawUnits: drawUnits.map((output, index) => ({
			...output.drawUnit,
			sourceMappingCoverage:
				sourceMappingCoverageBySliceId.get(
					renderablePartitions[index]?.sliceId ?? "",
				) ?? [],
			spatialRecord:
				spatialRecordBySliceId.get(
					renderablePartitions[index]?.sliceId ?? "",
				) ?? null,
		})),
		materialCoverage: partitionPlan.materialCoverage,
		sourceMappings: [],
		spatialRecords: [
			...spatialRecordBySliceId.values(),
			...drawUnits.flatMap((output) => output.objectSpatialRecords),
		],
		textureUses: createStaticObjectBakeTextureUses({
			partitions: partitionPlan.partitions,
			staticBatchId: input.staticBatchId,
			work: item.work,
		}),
	};
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
		`V2 skipped non-renderable static object partition ${partition.sliceId}.`,
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
	readonly attachments: StaticBakeBatchInput["attachments"];
	readonly work: ScheduledStaticWork;
	readonly payload: StaticObjectCompatibilityPayload;
	readonly partition: StaticObjectCompatibilityPartition;
}): StaticObjectGeometryBakeOutput {
	const sourceIndex = new StaticObjectBakeSourceIndex(
		options.payload,
		options.attachments,
	);
	const materialEntries = createStaticObjectMaterialTableEntries(options);
	const materialSlotByEntryKey = new Map<string, number>(
		options.partition.coarseTablePlan.entries.map((entry, index) => [
			entry.materialEntryKey,
			materialEntries[index]?.slot ?? index,
		]),
	);
	const geometry = bakeStaticObjectPartitionGeometry(
		options.partition.triangles,
		sourceIndex,
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
		alphaTest: materialEntry.alphaTest,
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
		materialColor: materialEntry.materialColor,
		materialEmissiveColor: materialEntry.materialEmissiveColor,
		materialEntries,
		materialFamily: resolveRenderableStaticObjectFamily(options.partition),
		materialIds: options.partition.materialIds,
		materialPass: resolveRenderableStaticObjectPass(options.partition),
		renderState: materialEntry.renderState,
		sort: createStaticObjectSortMetadata(options.partition, geometry.positions),
		detailTextureTiling: materialEntry.detailTextureTiling,
		detailTextureUseId: materialEntry.detailTextureUseId,
		positions: geometry.positions,
		indexTextureUseId: materialEntry.indexTextureUseId,
		indexedTextureFormat: materialEntry.indexedTextureFormat,
		indexedClipThreshold: materialEntry.indexedClipThreshold,
		paletteFirstIndex: materialEntry.paletteFirstIndex,
		paletteTextureUseId: materialEntry.paletteTextureUseId,
		primaryTextureUseId: materialEntry.primaryTextureUseId,
		primaryTextureWrapMode: materialEntry.primaryTextureWrapMode,
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
			drawUnitId,
			geometry,
			payload: options.payload,
		}),
	};
}

function createEnvCellStaticObjectSpatialRecords(options: {
	readonly drawUnitId: string;
	readonly geometry: ReturnType<typeof bakeStaticObjectPartitionGeometry>;
	readonly payload: StaticObjectCompatibilityPayload;
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
		([objectKey, bounds]): readonly StaticEnvCellStaticObjectSpatialRecord[] => {
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
					owner: {
						drawUnitId: options.drawUnitId,
						kind: "draw-unit",
					},
				},
			];
		},
	);
}

function createStaticObjectMaterialTableEntries(options: {
	readonly work: ScheduledStaticWork;
	readonly partition: StaticObjectCompatibilityPartition;
}): readonly StaticObjectMaterialTableEntry[] {
	return options.partition.coarseTablePlan.entries.map((entry, slot) =>
		createStaticObjectMaterialTableEntry({
			entry,
			options,
			slot,
		}),
	);
}

function createStaticObjectMaterialTableEntry(parameters: {
	readonly options: {
		readonly work: ScheduledStaticWork;
		readonly partition: StaticObjectCompatibilityPartition;
	};
	readonly entry: StaticObjectCompatibilityPartition["coarseTablePlan"]["entries"][number];
	readonly slot: number;
}): StaticObjectMaterialTableEntry {
	const { options } = parameters;
	const primaryTextureUse = parameters.entry.textureDataUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			textureUse.usage === "rgba-color",
	);
	const indexTextureUse = parameters.entry.textureDataUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			(textureUse.usage === "index8" || textureUse.usage === "index16"),
	);
	const paletteTextureUse = parameters.entry.textureDataUses.find(
		(textureUse) => textureUse.kind === "palette-texture-use",
	);
	const detailTextureUse = parameters.entry.textureDataUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			textureUse.usage === "rgba-detail",
	);
	const indexedTextureFormat =
		indexTextureUse?.kind === "prepared-render-surface-texture-use"
			? indexTextureUse.usage === "index16"
				? "index16"
				: "p8"
			: null;

	return {
		alphaTest: parameters.entry.alphaTest,
		indexedClipThreshold: parameters.entry.indexedClipThreshold,
		renderState: createStaticObjectRenderState(parameters.entry.blend),
		detailTextureTiling: parameters.entry.detailTextureTiling,
		detailTextureUseId: detailTextureUse
			? createStaticObjectTextureUseId(options.work, detailTextureUse)
			: null,
		indexedTextureFormat,
		indexTextureUseId: indexTextureUse
			? createStaticObjectTextureUseId(options.work, indexTextureUse)
			: null,
		materialColor: parameters.entry.materialColor,
		materialEmissiveColor: parameters.entry.materialEmissiveColor,
		materialIds: parameters.entry.materialIds,
		paletteFirstIndex:
			paletteTextureUse?.kind === "palette-texture-use"
				? paletteTextureUse.firstIndex
				: 0,
		paletteTextureUseId: paletteTextureUse
			? createStaticObjectTextureUseId(options.work, paletteTextureUse)
			: null,
		primaryTextureUseId: primaryTextureUse
			? createStaticObjectTextureUseId(options.work, primaryTextureUse)
			: null,
		primaryTextureWrapMode: parameters.entry.textureWrapMode,
		slot: parameters.slot,
	};
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

function createStaticObjectRenderState(
	blend: StaticObjectCompatibilityPartition["coarseTablePlan"]["entries"][number]["blend"],
): StaticObjectRenderState {
	return {
		blend: {
			dstFactor: blend.dstFactor,
			enabled: blend.enabled,
			mode: blend.mode,
			srcFactor: blend.srcFactor,
		},
		depthTest: true,
		depthWrite: blend.depthWrite,
	};
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
		const sourceTriangle = part.triangles.find(
			(candidate) =>
				candidate.polygonId === triangle.polygonId &&
				candidate.firstVertex === triangle.firstVertex &&
				candidate.geometrySurfaceId === triangle.geometrySurfaceId &&
				candidate.materialVariantSignature ===
					triangle.materialVariantSignature,
		);
		if (!sourceTriangle) {
			throw new Error(
				`Static object geometry partition references missing triangle ${triangle.sourceTriangleId}.`,
			);
		}
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
	const textureUsesById = new Map<string, StaticBakeTextureUse>();

	for (const partition of options.partitions) {
		if (partition.renderCoverage !== "classified-render-candidate") {
			continue;
		}

		const drawUnitId = `${options.work.workId}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`;
		for (const entry of partition.coarseTablePlan.entries) {
			for (const dataUse of entry.textureDataUses) {
				if (!isCurrentlyStageableStaticObjectDataUse(dataUse)) {
					continue;
				}

				const textureUseId = createStaticObjectTextureUseId(
					options.work,
					dataUse,
				);
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
					samplingPolicy: createStaticObjectSamplingPolicy(),
					source: dataUse,
					staticBatchId: options.staticBatchId,
					textureUseId,
				});
			}
		}
	}

	return [...textureUsesById.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function createStaticObjectTextureUseId(
	work: ScheduledStaticWork,
	dataUse: MaterialTextureDataUseIdentity,
): string {
	return [
		work.workId,
		"static-object-texture",
		createMaterialTextureDataUseKey(dataUse),
	].join(":");
}

function createStaticObjectSamplingPolicy(): StaticBakeTextureSamplingPolicy {
	return {
		wrapS: "clamp-to-edge",
		wrapT: "clamp-to-edge",
	};
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

export function createEnvCellStaticObjectCompatibilityPayload(
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
				instanceBounds: seed.instanceBounds,
				localPlacement: seed.localPlacement,
				owningEnvCellId: envCell.identity.envCellId,
				portalCount: 0,
				source: seed.source,
				sourceBounds: seed.sourceBounds,
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
