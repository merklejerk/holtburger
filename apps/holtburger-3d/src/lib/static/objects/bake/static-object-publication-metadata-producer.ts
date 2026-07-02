import type {
	StaticBounds,
	StaticLayerPeerRecordOwner,
	StaticObjectDrawUnitOwnership,
	StaticObjectInstanceIdentity,
	StaticObjectPartSourceFacts,
	StaticObjectRenderInstance,
	StaticObjectSourceIdentity,
	StaticObjectSourceMappingCoverage,
	StaticObjectSortMetadata,
} from "../../contracts";
import {
	createObjectVisualPartInstanceIndex,
	createObjectVisualStaticPublicationMetadata,
	createObjectVisualStaticResourceGroupId,
	type ObjectVisualPartInstanceIndex,
	type ObjectVisualStaticPublicationMetadata,
	type ObjectVisualStaticResourceGroupId,
} from "../../../visual/object-visual-static-publication";
import { createStaticObjectSourcePartMatrix } from "./static-object-visual-bundle-producer";
import type { StaticObjectBatchPayload } from "./static-object-batch-partitioner";

const GENERATED_SCENERY_INSTANCING_POLICY = {
	minimumInstanceCount: 2,
	transparentReuseAllowed: false,
} as const;

export interface StaticObjectPublicationMetadataProduction {
	readonly metadata: ObjectVisualStaticPublicationMetadata;
	readonly partInstanceIndexByKey: ReadonlyMap<
		string,
		ObjectVisualPartInstanceIndex
	>;
	readonly resourceGroupIdByKey: ReadonlyMap<
		string,
		ObjectVisualStaticResourceGroupId
	>;
}

export function createStaticObjectPublicationMetadata(input: {
	readonly owner: StaticLayerPeerRecordOwner;
	readonly payload: StaticObjectBatchPayload;
}): StaticObjectPublicationMetadataProduction {
	const partInstanceIndexByKey = createPartInstanceIndexByKey(input.payload);
	const generatedGroupIdByKey = createGeneratedResourceGroupIds(input.payload);

	return {
		metadata: createObjectVisualStaticPublicationMetadata({
			directStaticObjectDrawUnits: createDirectDrawUnitMetadata({
				owner: input.owner,
				partInstanceIndexByKey,
				payload: input.payload,
			}),
			instancedRenderInstances: createGeneratedRenderInstanceMetadata({
				generatedGroupIdByKey,
				partInstanceIndexByKey,
				payload: input.payload,
			}),
			instancedResourceGroups: createGeneratedResourceGroupMetadata({
				generatedGroupIdByKey,
				payload: input.payload,
			}),
			partInstanceCount: countPartInstances(input.payload),
		}),
		partInstanceIndexByKey,
		resourceGroupIdByKey: generatedGroupIdByKey,
	};
}

function countPartInstances(payload: StaticObjectBatchPayload): number {
	return payload.objects.reduce((count, object) => {
		const source = requireSource(payload, object.source);
		return count + source.parts.length;
	}, 0);
}

function createDirectDrawUnitMetadata(options: {
	readonly owner: StaticLayerPeerRecordOwner;
	readonly partInstanceIndexByKey: ReadonlyMap<
		string,
		ObjectVisualPartInstanceIndex
	>;
	readonly payload: StaticObjectBatchPayload;
}): ObjectVisualStaticPublicationMetadata["directStaticObjectDrawUnits"] {
	return options.payload.objects
		.filter((object) => object.identity.objectKind !== "generated-scenery")
		.map((object) => {
			const source = requireSource(options.payload, object.source);
			const partInstanceIndices = source.parts.map((part) =>
				requirePartInstanceIndex(options.partInstanceIndexByKey, object, part),
			);
			return {
				domain: options.payload.domain,
				drawUnitIdSeed: createObjectDrawUnitIdSeed(object.identity),
				kind: "static-object-direct-draw-unit" as const,
				landblockId: options.payload.landblock.landblockId,
				ownership: createDrawUnitOwnership(options.payload, object),
				partInstanceIndices,
				sort: createSortMetadata(object),
				sourceMappingCoverage: source.parts.flatMap((part) =>
					createSourceMappingCoverage(object, part),
				),
				spatialRecord: createSpatialRecord(options.owner, object),
			};
		});
}

function createGeneratedResourceGroupMetadata(options: {
	readonly generatedGroupIdByKey: ReadonlyMap<
		string,
		ObjectVisualStaticResourceGroupId
	>;
	readonly payload: StaticObjectBatchPayload;
}): ObjectVisualStaticPublicationMetadata["instancedResourceGroups"] {
	const groups = new Map<
		string,
		{
			readonly groupId: ObjectVisualStaticResourceGroupId;
			readonly part: StaticObjectPartSourceFacts;
		}
	>();
	for (const object of options.payload.objects) {
		if (object.identity.objectKind !== "generated-scenery") {
			continue;
		}
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			const key = createGeneratedResourceGroupKey(part);
			groups.set(key, {
				groupId: requireResourceGroupId(options.generatedGroupIdByKey, key),
				part,
			});
		}
	}
	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, group]) => ({
			geometry: group.part.geometry,
			groupId: group.groupId,
			kind: "static-object-instanced-resource-group" as const,
			minimumInstanceCount:
				GENERATED_SCENERY_INSTANCING_POLICY.minimumInstanceCount,
			resourceIdSeed: `static-object-resource:${key}`,
			transparentReuseAllowed:
				GENERATED_SCENERY_INSTANCING_POLICY.transparentReuseAllowed,
		}));
}

function createGeneratedRenderInstanceMetadata(options: {
	readonly generatedGroupIdByKey: ReadonlyMap<
		string,
		ObjectVisualStaticResourceGroupId
	>;
	readonly partInstanceIndexByKey: ReadonlyMap<
		string,
		ObjectVisualPartInstanceIndex
	>;
	readonly payload: StaticObjectBatchPayload;
}): ObjectVisualStaticPublicationMetadata["instancedRenderInstances"] {
	return options.payload.objects.flatMap((object) => {
		if (object.identity.objectKind !== "generated-scenery") {
			return [];
		}
		const source = requireSource(options.payload, object.source);
		return source.parts.map((part) => {
			const groupKey = createGeneratedResourceGroupKey(part);
			const bounds = requireStaticObjectBounds(object);
			const sortCenter = centerVec3OfBounds(bounds);
			return {
				bounds,
				domain: "outdoor-generated-scenery" as const,
				generated: object.generated,
				groupId: requireResourceGroupId(
					options.generatedGroupIdByKey,
					groupKey,
				),
				instanceIdSeed: `${createObjectKey(object.identity)}:part:${part.partIndex}`,
				kind: "static-object-instanced-render-instance" as const,
				landblockId: options.payload.landblock.landblockId,
				partInstanceIndex: requirePartInstanceIndex(
					options.partInstanceIndexByKey,
					object,
					part,
				),
				sortCenter,
				source: object.identity,
				sourceToLandblockMatrix: createStaticObjectSourcePartMatrix(
					object,
					part,
				),
				transform: object.localPlacement,
				transparency: { kind: "depth-writing" as const },
			};
		});
	});
}

function createPartInstanceIndexByKey(
	payload: StaticObjectBatchPayload,
): ReadonlyMap<string, ObjectVisualPartInstanceIndex> {
	const indices = new Map<string, ObjectVisualPartInstanceIndex>();
	let index = 0;
	for (const object of payload.objects) {
		const source = requireSource(payload, object.source);
		for (const part of source.parts) {
			indices.set(
				createPartInstanceKey(object, part),
				createObjectVisualPartInstanceIndex(index),
			);
			index += 1;
		}
	}
	return indices;
}

function createGeneratedResourceGroupIds(
	payload: StaticObjectBatchPayload,
): ReadonlyMap<string, ObjectVisualStaticResourceGroupId> {
	const keys = new Set<string>();
	for (const object of payload.objects) {
		if (object.identity.objectKind !== "generated-scenery") {
			continue;
		}
		const source = requireSource(payload, object.source);
		for (const part of source.parts) {
			keys.add(createGeneratedResourceGroupKey(part));
		}
	}
	return new Map(
		[...keys]
			.sort((left, right) => left.localeCompare(right))
			.map((key, index) => [
				key,
				createObjectVisualStaticResourceGroupId(index),
			]),
	);
}

function createSourceMappingCoverage(
	object: StaticObjectBatchPayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): readonly StaticObjectSourceMappingCoverage[] {
	const trianglesBySlot = new Map<
		number,
		{
			readonly geometrySurfaceIds: Set<number>;
			readonly materialIds: Set<number>;
			readonly materialVariantSignatures: Set<string>;
			readonly polygonIds: number[];
			readonly sourceTriangleCount: number;
		}
	>();
	for (const triangle of part.triangles) {
		if (triangle.geometrySurfaceId === null) {
			continue;
		}
		const slot = part.materialSlots.find(
			(candidate) =>
				candidate.geometrySurfaceId === triangle.geometrySurfaceId &&
				candidate.materialVariantSignature ===
					triangle.materialVariantSignature,
		);
		if (!slot) {
			continue;
		}
		const bucket = trianglesBySlot.get(slot.slotIndex) ?? {
			geometrySurfaceIds: new Set<number>(),
			materialIds: new Set<number>(),
			materialVariantSignatures: new Set<string>(),
			polygonIds: [],
			sourceTriangleCount: 0,
		};
		bucket.geometrySurfaceIds.add(triangle.geometrySurfaceId);
		bucket.materialIds.add(slot.material.materialId);
		bucket.materialVariantSignatures.add(
			triangle.materialVariantSignature ?? "__null__",
		);
		bucket.polygonIds.push(triangle.polygonId);
		trianglesBySlot.set(slot.slotIndex, {
			...bucket,
			sourceTriangleCount: bucket.sourceTriangleCount + 1,
		});
	}
	return [...trianglesBySlot.entries()]
		.sort(([left], [right]) => left - right)
		.map(([materialSlot, bucket]) => ({
			geometrySurfaceIds: [...bucket.geometrySurfaceIds].sort(
				(left, right) => left - right,
			),
			gfxObj: part.gfxObj,
			materialIds: [...bucket.materialIds].sort((left, right) => left - right),
			materialSlot,
			materialVariantSignatures: [...bucket.materialVariantSignatures]
				.sort()
				.map((signature) => (signature === "__null__" ? null : signature)),
			object: object.identity,
			partIndex: part.partIndex,
			polygonCount: new Set(bucket.polygonIds).size,
			polygonRange:
				bucket.polygonIds.length === 0
					? null
					: {
							max: Math.max(...bucket.polygonIds),
							min: Math.min(...bucket.polygonIds),
						},
			source: object.source,
			sourceTriangleCount: bucket.sourceTriangleCount,
		}));
}

function createDrawUnitOwnership(
	payload: StaticObjectBatchPayload,
	object: StaticObjectBatchPayload["objects"][number],
): StaticObjectDrawUnitOwnership {
	if (payload.domain !== "env-cell-system") {
		return {
			domain: payload.domain,
			kind: "outdoor-static-objects",
			landblockId: payload.landblock.landblockId,
		};
	}
	return {
		envCellIds:
			object.owningEnvCellId === undefined || object.owningEnvCellId === null
				? []
				: [object.owningEnvCellId],
		kind: "env-cell-static-object-placements",
		landblockId: payload.landblock.landblockId,
		seedIdentities: [object.identity],
	};
}

function createSortMetadata(
	object: StaticObjectBatchPayload["objects"][number],
): StaticObjectSortMetadata {
	const bounds = object.instanceBounds ?? object.sourceBounds;
	return {
		bounds,
		center: bounds ? centerTupleOfBounds(bounds) : [0, 0, 0],
		objectPartKey: `${createObjectKey(object.identity)}:part:*`,
		policy: "depth-writing",
	};
}

function createSpatialRecord(
	owner: StaticLayerPeerRecordOwner,
	object: StaticObjectBatchPayload["objects"][number],
) {
	if (
		object.owningEnvCellId === undefined ||
		object.owningEnvCellId === null ||
		!object.instanceBounds
	) {
		return null;
	}
	return {
		bounds: object.instanceBounds,
		envCellId: object.owningEnvCellId,
		instanceId: object.identity.instanceId,
		kind: "env-cell-static-object-bounds" as const,
		landblockId: object.identity.landblockId,
		owner,
	};
}

function requirePartInstanceIndex(
	partInstanceIndexByKey: ReadonlyMap<string, ObjectVisualPartInstanceIndex>,
	object: StaticObjectBatchPayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): ObjectVisualPartInstanceIndex {
	const key = createPartInstanceKey(object, part);
	const index = partInstanceIndexByKey.get(key);
	if (index === undefined) {
		throw new Error(`Missing part-instance index for ${key}.`);
	}
	return index;
}

function requireResourceGroupId(
	resourceGroupIdByKey: ReadonlyMap<string, ObjectVisualStaticResourceGroupId>,
	key: string,
): ObjectVisualStaticResourceGroupId {
	const groupId = resourceGroupIdByKey.get(key);
	if (groupId === undefined) {
		throw new Error(`Missing static object resource group id for ${key}.`);
	}
	return groupId;
}

function requireStaticObjectBounds(
	object: StaticObjectBatchPayload["objects"][number],
): StaticBounds {
	const bounds = object.instanceBounds ?? object.sourceBounds;
	if (!bounds) {
		throw new Error(
			`Static object ${createObjectKey(object.identity)} requires bounds for instanced publication metadata.`,
		);
	}
	return bounds;
}

function centerVec3OfBounds(
	bounds: StaticBounds,
): StaticObjectRenderInstance["sortCenter"] {
	return {
		x: (bounds.min.x + bounds.max.x) / 2,
		y: (bounds.min.y + bounds.max.y) / 2,
		z: (bounds.min.z + bounds.max.z) / 2,
	};
}

function centerTupleOfBounds(
	bounds: StaticBounds,
): readonly [number, number, number] {
	return [
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	];
}

function createPartInstanceKey(
	object: StaticObjectBatchPayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): string {
	return [
		createObjectKey(object.identity),
		createSourceKey(part.source),
		createSourceKey(part.gfxObj),
		`part:${part.partIndex}`,
	].join("|");
}

function createGeneratedResourceGroupKey(
	part: StaticObjectPartSourceFacts,
): string {
	return [
		"generated",
		createSourceKey(part.source),
		createSourceKey(part.gfxObj),
		`part:${part.partIndex}`,
	].join("|");
}

function createObjectDrawUnitIdSeed(
	identity: StaticObjectInstanceIdentity,
): string {
	return `static-object:${createObjectKey(identity)}`;
}

function requireSource(
	payload: StaticObjectBatchPayload,
	identity: StaticObjectSourceIdentity,
): StaticObjectBatchPayload["sourceAssets"][number] {
	const source = payload.sourceAssets.find(
		(candidate) =>
			createSourceKey(candidate.identity) === createSourceKey(identity),
	);
	if (!source) {
		throw new Error(
			`Static object publication metadata references missing source ${createSourceKey(identity)}.`,
		);
	}
	return source;
}

function createObjectKey(identity: StaticObjectInstanceIdentity): string {
	return [
		formatHex32(identity.landblockId),
		identity.objectKind,
		identity.instanceId,
	].join(":");
}

function createSourceKey(identity: StaticObjectSourceIdentity): string {
	return [
		identity.kind,
		identity.sourceAssetKind,
		formatHex32(identity.sourceDid),
	].join(":");
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
