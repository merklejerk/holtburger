import type {
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectsScopePayload,
	ScheduledStaticWork,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureSamplingPolicy,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectMaterialTableEntry,
	StaticObjectInstanceIdentity,
	StaticObjectPartSourceFacts,
	StaticObjectSourceIdentity,
} from "../../contracts";
import {
	createMaterialTextureDataUseKey,
	partitionStaticObjectCompatibility,
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
		input.domain !== "outdoor-detail"
	) {
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

function bakeStaticObjectCompatibilityItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticBakeBatchResult["materialCoverage"][number];
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

	const scope = item.payload.scope;
	const partitionPlan = partitionStaticObjectCompatibility(scope);
	const drawUnits = partitionPlan.partitions.map((partition) =>
		createPartitionDrawUnit(item.work, scope, partition),
	);
	const drawUnitIdBySliceId = new Map(
		partitionPlan.partitions.map((partition, index) => [
			partition.sliceId,
			drawUnits[index]?.drawUnitId ?? "",
		]),
	);

	return {
		drawUnits,
		materialCoverage: partitionPlan.materialCoverage,
		sourceMappings: partitionPlan.partitions.flatMap((partition) => {
			const drawUnitId = drawUnitIdBySliceId.get(partition.sliceId);
			if (!drawUnitId) {
				return [];
			}
			return partition.triangles.map((triangle) =>
				createStaticObjectSourceMapping(drawUnitId, triangle),
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

function createStaticObjectSourceMapping(
	drawUnitId: string,
	triangle: StaticObjectCompatibilityTriangle,
): string {
	return [
		drawUnitId,
		`source:${createSourceKey(triangle.source)}`,
		`gfx:${createSourceKey(triangle.gfxObj)}`,
		`object:${createObjectKey(triangle.object)}`,
		`part:${triangle.partIndex}`,
		`polygon:${triangle.polygonId}`,
		`first-vertex:${triangle.firstVertex}`,
		`geometry-surface:${triangle.geometrySurfaceId}`,
		`variant:${triangle.materialVariantSignature ?? "base"}`,
	].join(":");
}

function createPartitionDrawUnit(
	work: ScheduledStaticWork,
	payload: OutdoorStaticObjectsScopePayload,
	partition: StaticObjectCompatibilityPartition,
): StaticDrawUnit {
	if (isRenderableStaticObjectPartition(partition)) {
		return createStaticObjectGeometryDrawUnit({
			partition,
			payload,
			textureUses: getRenderableTextureUses(partition),
			work,
		});
	}

	return {
		drawUnitId: `${work.workId}:static-object-partition:${partition.sliceId.replaceAll("/", "-")}`,
		kind: "placeholder",
	};
}

function getRenderableTextureUses(
	partition: StaticObjectCompatibilityPartition,
): readonly MaterialTextureDataUseIdentity[] {
	if (partition.family === "flat-color") {
		return [];
	}

	if (partition.textureDataUses.length === 0) {
		throw new Error(
			`Renderable static object texture partition ${partition.sliceId} has no texture data use.`,
		);
	}

	return partition.textureDataUses;
}

function createStaticObjectGeometryDrawUnit(options: {
	readonly work: ScheduledStaticWork;
	readonly payload: OutdoorStaticObjectsScopePayload;
	readonly partition: StaticObjectCompatibilityPartition;
	readonly textureUses: readonly MaterialTextureDataUseIdentity[];
}): StaticObjectGeometryStaticDrawUnit {
	const sourceIndex = new StaticObjectBakeSourceIndex(options.payload);
	const geometry = bakeStaticObjectPartitionGeometry(
		options.partition.triangles,
		sourceIndex,
	);
	const textureUseIds = options.textureUses.map((textureUse) =>
		createStaticObjectTextureUseId(
			options.work,
			textureUse,
			resolveStaticObjectTextureUseWrapMode(
				textureUse,
				options.partition.textureWrapMode,
			),
		),
	);
	const primaryTextureUse = options.textureUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			textureUse.usage === "rgba-color",
	);
	const indexTextureUse = options.textureUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			(textureUse.usage === "index8" || textureUse.usage === "index16"),
	);
	const paletteTextureUse = options.textureUses.find(
		(textureUse) => textureUse.kind === "palette-texture-use",
	);
	const detailTextureUse = options.textureUses.find(
		(textureUse) =>
			textureUse.kind === "prepared-render-surface-texture-use" &&
			textureUse.usage === "rgba-detail",
	);
	const materialEntry = createStaticObjectMaterialTableEntry({
		detailTextureUse,
		indexTextureUse,
		options,
		paletteTextureUse,
		primaryTextureUse,
	});

	return {
		alphaTest: materialEntry.alphaTest,
		coordinateSpace: "landblock-render-local",
		domain: options.work.job.domain as "outdoor-buildings" | "outdoor-detail",
		drawUnitId: `${options.work.workId}:static-object-partition:${options.partition.sliceId.replaceAll("/", "-")}`,
		indexType: geometry.indices instanceof Uint16Array ? "uint16" : "uint32",
		indices: geometry.indices,
		kind: "static-object-geometry",
		landblockId: options.payload.landblock.landblockId,
		materialBucketKey: options.partition.compatibilityKey,
		materialColor: materialEntry.materialColor,
		materialEmissiveColor: materialEntry.materialEmissiveColor,
		materialEntries: [materialEntry],
		materialFamily: resolveRenderableStaticObjectFamily(options.partition),
		materialIds: options.partition.materialIds,
		materialPass: resolveRenderableStaticObjectPass(options.partition),
		detailTextureTiling: materialEntry.detailTextureTiling,
		detailTextureUseId: materialEntry.detailTextureUseId,
		positions: geometry.positions,
		indexTextureUseId: materialEntry.indexTextureUseId,
		indexedTextureFormat: materialEntry.indexedTextureFormat,
		paletteFirstIndex: materialEntry.paletteFirstIndex,
		paletteTextureUseId: materialEntry.paletteTextureUseId,
		primaryTextureUseId: materialEntry.primaryTextureUseId,
		primaryTextureWrapMode: materialEntry.primaryTextureWrapMode,
		texCoords: geometry.texCoords,
		materialSlotIndices: geometry.materialSlotIndices,
		textureUseIds,
		triangleCount: options.partition.triangleCount,
		vertexCount: options.partition.triangleCount * 3,
	};
}

function createStaticObjectMaterialTableEntry(parameters: {
	readonly options: {
		readonly work: ScheduledStaticWork;
		readonly partition: StaticObjectCompatibilityPartition;
	};
	readonly primaryTextureUse: MaterialTextureDataUseIdentity | undefined;
	readonly indexTextureUse: MaterialTextureDataUseIdentity | undefined;
	readonly paletteTextureUse: MaterialTextureDataUseIdentity | undefined;
	readonly detailTextureUse: MaterialTextureDataUseIdentity | undefined;
}): StaticObjectMaterialTableEntry {
	const { options } = parameters;
	const indexedTextureFormat =
		parameters.indexTextureUse?.kind === "prepared-render-surface-texture-use"
			? parameters.indexTextureUse.usage === "index16"
				? "index16"
				: "p8"
			: null;

	return {
		alphaTest: options.partition.alphaTest,
		detailTextureTiling: options.partition.detailTextureTiling,
		detailTextureUseId: parameters.detailTextureUse
			? createStaticObjectTextureUseId(
					options.work,
					parameters.detailTextureUse,
					resolveStaticObjectTextureUseWrapMode(
						parameters.detailTextureUse,
						options.partition.textureWrapMode,
					),
				)
			: null,
		indexedTextureFormat,
		indexTextureUseId: parameters.indexTextureUse
			? createStaticObjectTextureUseId(
					options.work,
					parameters.indexTextureUse,
					options.partition.textureWrapMode,
				)
			: null,
		materialColor: options.partition.materialColor,
		materialEmissiveColor: options.partition.materialEmissiveColor,
		materialIds: options.partition.materialIds,
		paletteFirstIndex:
			parameters.paletteTextureUse?.kind === "palette-texture-use"
				? parameters.paletteTextureUse.firstIndex
				: 0,
		paletteTextureUseId: parameters.paletteTextureUse
			? createStaticObjectTextureUseId(
					options.work,
					parameters.paletteTextureUse,
					options.partition.textureWrapMode,
				)
			: null,
		primaryTextureUseId: parameters.primaryTextureUse
			? createStaticObjectTextureUseId(
					options.work,
					parameters.primaryTextureUse,
					options.partition.textureWrapMode,
				)
			: null,
		primaryTextureWrapMode: options.partition.textureWrapMode,
		slot: 0,
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
	if (partition.pass === "opaque" || partition.pass === "alpha-test") {
		return partition.pass;
	}

	throw new Error(
		`Static object partition ${partition.sliceId} has unrenderable pass ${partition.pass}.`,
	);
}

class StaticObjectBakeSourceIndex {
	readonly #objectsByKey = new Map<
		string,
		OutdoorStaticObjectsScopePayload["objects"][number]
	>();
	readonly #sourcesByKey = new Map<
		string,
		OutdoorStaticObjectsScopePayload["sourceAssets"][number]
	>();

	constructor(payload: OutdoorStaticObjectsScopePayload) {
		for (const object of payload.objects) {
			this.#objectsByKey.set(createObjectKey(object.identity), object);
		}
		for (const source of payload.sourceAssets) {
			this.#sourcesByKey.set(createSourceKey(source.identity), source);
		}
	}

	getObject(
		identity: StaticObjectInstanceIdentity,
	): OutdoorStaticObjectsScopePayload["objects"][number] {
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
}

function bakeStaticObjectPartitionGeometry(
	triangles: readonly StaticObjectCompatibilityTriangle[],
	sourceIndex: StaticObjectBakeSourceIndex,
): {
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
} {
	const vertexCount = triangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const texCoords = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices = createIndexArray(vertexCount);

	for (const [triangleIndex, triangle] of triangles.entries()) {
		const object = sourceIndex.getObject(triangle.object);
		const part = sourceIndex.getPart(
			triangle.source,
			triangle.gfxObj,
			triangle.partIndex,
		);
		const sourceTriangle = part.triangles.find(
			(candidate) =>
				candidate.polygonId === triangle.polygonId &&
				candidate.firstVertex === triangle.firstVertex &&
				candidate.geometrySurfaceId === triangle.geometrySurfaceId &&
				candidate.materialVariantSignature === triangle.materialVariantSignature,
		);
		if (!sourceTriangle) {
			throw new Error(
				`Static object geometry partition references missing triangle ${triangle.sourceTriangleId}.`,
			);
		}

		const matrix = createStaticObjectSourcePartMatrix(object, part);
		for (let triangleVertex = 0; triangleVertex < 3; triangleVertex += 1) {
			const sourceVertexIndex = sourceTriangle.firstVertex + triangleVertex;
			const targetVertexIndex = triangleIndex * 3 + triangleVertex;
			writeTransformedPosition({
				matrix,
				positions,
				source: part.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			writeTexCoord({
				source: part.texCoords,
				sourceVertexIndex,
				target: texCoords,
				targetVertexIndex,
			});
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		indices,
		materialSlotIndices,
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
		for (const dataUse of partition.textureDataUses) {
			if (!isCurrentlyStageableStaticObjectDataUse(dataUse)) {
				continue;
			}

			const textureUseId = createStaticObjectTextureUseId(
				options.work,
				dataUse,
				resolveStaticObjectTextureUseWrapMode(
					dataUse,
					partition.textureWrapMode,
				),
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
				samplingPolicy: createStaticObjectSamplingPolicy(
					resolveStaticObjectTextureUseWrapMode(
						dataUse,
						partition.textureWrapMode,
					),
				),
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

function createStaticObjectTextureUseId(
	work: ScheduledStaticWork,
	dataUse: MaterialTextureDataUseIdentity,
	textureWrapMode: StaticObjectCompatibilityPartition["textureWrapMode"],
): string {
	return [
		work.workId,
		"static-object-texture",
		createMaterialTextureDataUseKey(dataUse),
		`wrap:${textureWrapMode}`,
	].join(":");
}

function resolveStaticObjectTextureUseWrapMode(
	dataUse: MaterialTextureDataUseIdentity,
	fallbackWrapMode: StaticObjectCompatibilityPartition["textureWrapMode"],
): StaticObjectCompatibilityPartition["textureWrapMode"] {
	return dataUse.kind === "prepared-render-surface-texture-use" &&
		dataUse.usage === "rgba-detail"
		? "repeat"
		: fallbackWrapMode;
}

function createStaticObjectSamplingPolicy(
	textureWrapMode: StaticObjectCompatibilityPartition["textureWrapMode"],
): StaticBakeTextureSamplingPolicy {
	const wrap = textureWrapMode === "repeat" ? "repeat" : "clamp-to-edge";
	return {
		wrapS: wrap,
		wrapT: wrap,
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

function createIndexArray(vertexCount: number): Uint16Array | Uint32Array {
	return vertexCount <= 0xffff
		? new Uint16Array(vertexCount)
		: new Uint32Array(vertexCount);
}

function createStaticObjectSourcePartMatrix(
	object: OutdoorStaticObjectsScopePayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): Float32Array {
	let matrix = buildAcPlacementMatrix(object.localPlacement, UNIT_SCALE);
	for (const placement of part.defaultPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(placement, UNIT_SCALE),
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

const UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

function writeTransformedPosition(options: {
	readonly source: Float32Array;
	readonly positions: Float32Array;
	readonly matrix: Float32Array;
	readonly sourceVertexIndex: number;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 3;
	const x = options.source[sourceOffset] ?? 0;
	const y = options.source[sourceOffset + 1] ?? 0;
	const z = options.source[sourceOffset + 2] ?? 0;
	const targetOffset = options.targetVertexIndex * 3;

	options.positions[targetOffset] =
		options.matrix[0] * x +
		options.matrix[4] * y +
		options.matrix[8] * z +
		options.matrix[12];
	options.positions[targetOffset + 1] =
		options.matrix[1] * x +
		options.matrix[5] * y +
		options.matrix[9] * z +
		options.matrix[13];
	options.positions[targetOffset + 2] =
		options.matrix[2] * x +
		options.matrix[6] * y +
		options.matrix[10] * z +
		options.matrix[14];
}

function writeTexCoord(options: {
	readonly source: Float32Array;
	readonly target: Float32Array;
	readonly sourceVertexIndex: number;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 2;
	const targetOffset = options.targetVertexIndex * 2;
	options.target[targetOffset] = options.source[sourceOffset] ?? 0;
	options.target[targetOffset + 1] = options.source[sourceOffset + 1] ?? 0;
}

function buildAcPlacementMatrix(
	placement: OutdoorStaticObjectsScopePayload["objects"][number]["localPlacement"],
	scale: { readonly x: number; readonly y: number; readonly z: number },
): Float32Array {
	const rotation = buildAcRotationMatrix(placement.orientation);
	const scaleMatrix = createPlacementScaleMatrix(scale);
	const transform = multiplyMat4(rotation, scaleMatrix);
	transform[12] = placement.origin.x;
	transform[13] = placement.origin.z;
	transform[14] = -placement.origin.y;
	return transform;
}

function buildAcRotationMatrix(quaternion: {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): Float32Array {
	const acRotation = buildQuaternionRotationMatrix(quaternion);
	const acToRender = new Float32Array([
		1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
	]);
	const renderToAc = new Float32Array([
		1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1,
	]);
	return multiplyMat4(multiplyMat4(acToRender, acRotation), renderToAc);
}

function buildQuaternionRotationMatrix(quaternion: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly w: number;
}): Float32Array {
	const { x, y, z, w } = quaternion;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;

	return new Float32Array([
		1 - (yy + zz),
		xy + wz,
		xz - wy,
		0,
		xy - wz,
		1 - (xx + zz),
		yz + wx,
		0,
		xz + wy,
		yz - wx,
		1 - (xx + yy),
		0,
		0,
		0,
		0,
		1,
	]);
}

function createStaticObjectSourceScaleMatrix(scale: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): Float32Array {
	return new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		1,
	]);
}

function createPlacementScaleMatrix(scale: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): Float32Array {
	return new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		1,
	]);
}

function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
	const result = new Float32Array(16);

	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			result[column * 4 + row] =
				left[0 * 4 + row] * right[column * 4 + 0] +
				left[1 * 4 + row] * right[column * 4 + 1] +
				left[2 * 4 + row] * right[column * 4 + 2] +
				left[3 * 4 + row] * right[column * 4 + 3];
		}
	}

	return result;
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

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
