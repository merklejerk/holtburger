import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import {
	staticObjectDetailRoleForSource,
	type StaticDetailRole,
} from "../resolution/static-detail-role";
import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import {
	orderResolvedObjectParts,
	resolveObjectPartTransforms,
	type ResolvedGeometry,
	type ResolvedObjectPart,
} from "../resolution/presentation";
import {
	createScaleMat4,
	multiplyMat4,
	transformNormal3,
	transformPoint3,
} from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { StaticGeometryKey } from "../geometry/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	StaticInstallResourceNamespace,
	StaticInstanceData,
	StaticInstanceStreamKey,
	StaticInstanceStreamSource,
} from "../systems/static-resources";
import { STATIC_INSTANCE_RECORD_BYTES } from "../systems/static-resources";
import type {
	FrameStreamedStaticInstanceTemplate,
	StaticObjectDrawUnit,
	StaticObjectMaterialBinding,
} from "./artifacts";
import { FRAME_STREAMED_STATIC_INSTANCE_TEMPLATE_BYTES } from "./artifacts";
import { resolveStaticTriangleMaterial } from "./static-material-binding";

/** One closed geometry job containing no runtime, device, or atlas callbacks. */
export interface StaticObjectGeometryPreparationJob {
	/** Typed source layer keeps geometry identities and later publication domains distinct. */
	readonly layer: ResolvedStaticObjectLayerSource["kind"];
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly source: ResolvedStaticObjectLayerSource;
}

/** Immutable material range emitted by the geometry worker. */
interface BakedStaticObjectRange {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	/** Stable sorter input exists only for transparent ranges. */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: Vec3;
	} | null;
}

/** Complete strategy-neutral geometry result returned by the closed worker. */
export interface StaticObjectGeometryPreparationResult {
	readonly geometry: readonly {
		readonly key: StaticGeometryKey;
		readonly geometry: ObjectGeometryData;
	}[];
	readonly instanceStreams: readonly StaticInstanceStreamSource[];
	readonly drawUnits: readonly StaticObjectDrawUnit[];
	readonly frameStreamedInstances: readonly FrameStreamedStaticInstanceTemplate[];
	readonly bounds: AABB3;
	readonly metrics: {
		readonly sourceResidentCount: number;
		readonly sourcePartCount: number;
		/** Resident/part/material-slot submissions before polygon-side facts split a range. */
		readonly sourceMaterialSlotCount: number;
		/** Resident/part/complete-binding submissions before permitted baking merges. */
		readonly sourceRangeCount: number;
		readonly bakedDrawUnitCount: number;
		readonly bakedGeometryBytes: number;
		readonly persistentCohortCount: number;
		readonly persistentStreamCount: number;
		readonly persistentDrawUnitCount: number;
		readonly persistentInstanceCount: number;
		readonly instancedGeometryBytes: number;
		readonly persistentStreamBytes: number;
		readonly transparentTemplateCohortCount: number;
		readonly transparentTemplateInstanceCount: number;
		readonly transparentTemplateBytes: number;
		/** Wall-clock algorithm time measured inside the worker boundary. */
		readonly workerDurationMs: number;
	};
}

interface SourceTriangleContribution {
	readonly binding: StaticObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	/** Source triangle identity retained for exact partition membership. */
	readonly sourceTriangleIndex: number;
	/** Interleaved XYZ values for the triangle's three positions. */
	readonly positions: readonly number[];
	/** Interleaved XYZ values for the triangle's three normals. */
	readonly normals: readonly number[];
	readonly textureCoordinates: readonly number[];
}

interface BakedTriangleContribution extends SourceTriangleContribution {
	readonly transparentStableId: string | null;
}

interface ContributionGroup {
	readonly binding: StaticObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	readonly triangles: BakedTriangleContribution[];
	readonly transparentStableId: string | null;
}

interface PreparedResidentPart {
	readonly contributions: readonly SourceTriangleContribution[];
	readonly geometryId: ResolvedGeometry["id"];
	/** Unresolved substitutions require the explicit baked path until resolution owns them. */
	readonly instanceAppearanceSupported: boolean;
	readonly partIndex: number;
	readonly residentId: string;
	readonly sourceToLandblock: Mat4;
}

interface PreparedStaticSource {
	readonly parts: readonly PreparedResidentPart[];
	readonly sourcePartCount: number;
	readonly sourceResidentCount: number;
	readonly sourceMaterialSlotCount: number;
	readonly sourceRangeCount: number;
}

/**
 * Prepare every static resident through the typed layer's selected geometry strategy. This
 * function is deliberately closed: it receives every source and material fact before execution
 * and never asks callers for device state, texture placement, or additional residency.
 */
export function prepareStaticObjectGeometry(
	job: StaticObjectGeometryPreparationJob,
): StaticObjectGeometryPreparationResult | null {
	assertJobLayer(job);
	const startedAt = performance.now();
	const prepared = prepareStaticSource(job.source);
	if (
		job.layer === LandblockLayerKind.Generated ||
		job.layer === LandblockLayerKind.EnvCells
	) {
		return prepareGeneratedStaticObjectGeometry(job, prepared, startedAt);
	}
	return prepareBakedStaticObjectGeometry(job, prepared, startedAt);
}

function prepareBakedStaticObjectGeometry(
	job: StaticObjectGeometryPreparationJob,
	prepared: PreparedStaticSource,
	startedAt: number,
	keySuffix = `${job.layer}-layer`,
): StaticObjectGeometryPreparationResult | null {
	const groups = new Map<string, ContributionGroup>();
	for (const part of prepared.parts) {
		for (const sourceContribution of part.contributions) {
			const contribution = transformTriangleContribution(
				sourceContribution,
				part.sourceToLandblock,
				part.residentId,
				part.partIndex,
			);
			const groupKey =
				contribution.transparentStableId ?? contribution.bindingId;
			const existing = groups.get(groupKey);
			if (existing) {
				existing.triangles.push(contribution);
				continue;
			}
			groups.set(groupKey, {
				binding: contribution.binding,
				bindingId: contribution.bindingId,
				ordering: contribution.ordering,
				triangles: [contribution],
				transparentStableId: contribution.transparentStableId,
			});
		}
	}
	if (groups.size === 0) return null;

	const sortedGroups = [...groups.values()].sort(compareGroups);
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	const ranges: BakedStaticObjectRange[] = [];
	const bounds = emptyBounds();
	for (const group of sortedGroups) {
		const indexStart = indices.length;
		const center = Vec3.zero();
		let centerPointCount = 0;
		for (const triangle of group.triangles) {
			for (let vertex = 0; vertex < 3; vertex += 1) {
				const positionOffset = vertex * 3;
				const x = triangle.positions[positionOffset]!;
				const y = triangle.positions[positionOffset + 1]!;
				const z = triangle.positions[positionOffset + 2]!;
				const normalX = triangle.normals[positionOffset]!;
				const normalY = triangle.normals[positionOffset + 1]!;
				const normalZ = triangle.normals[positionOffset + 2]!;
				assertFiniteComponents(x, y, z, "baked position");
				assertFiniteComponents(normalX, normalY, normalZ, "baked normal");
				expandBounds(bounds, x, y, z);
				center.x += x;
				center.y += y;
				center.z += z;
				centerPointCount += 1;
				const index = positions.length / 3;
				positions.push(x, y, z);
				normals.push(normalX, normalY, normalZ);
				textureCoordinates.push(
					triangle.textureCoordinates[vertex * 2]!,
					triangle.textureCoordinates[vertex * 2 + 1]!,
				);
				indices.push(index);
			}
		}
		const transparentSort =
			group.transparentStableId === null
				? null
				: {
						center: new Vec3(
							center.x / centerPointCount,
							center.y / centerPointCount,
							center.z / centerPointCount,
						),
						stableId: group.transparentStableId,
					};
		ranges.push({
			indexCount: indices.length - indexStart,
			indexStart,
			material: group.binding,
			ordering: group.ordering,
			transparentSort,
		});
	}
	assertBounds(bounds, positions);
	const geometry: ObjectGeometryData = {
		indices: Uint32Array.from(indices),
		kind: "object",
		normals: Float32Array.from(normals),
		positions: Float32Array.from(positions),
		textureCoordinates: Float32Array.from(textureCoordinates),
	};
	const geometryKey =
		`static-install-geometry:${job.resourceNamespace}/${keySuffix}` as StaticGeometryKey;
	return {
		bounds,
		drawUnits: ranges.map((range) => ({
			geometry: geometryKey,
			indexCount: range.indexCount,
			indexStart: range.indexStart,
			kind: "baked" as const,
			material: range.material,
			ordering: range.ordering,
			transparentSort: range.transparentSort,
		})),
		frameStreamedInstances: [],
		geometry: [{ geometry, key: geometryKey }],
		instanceStreams: [],
		metrics: {
			bakedDrawUnitCount: ranges.length,
			bakedGeometryBytes:
				geometry.positions.byteLength +
				geometry.normals.byteLength +
				geometry.textureCoordinates.byteLength +
				geometry.indices.byteLength,
			instancedGeometryBytes: 0,
			persistentCohortCount: 0,
			persistentDrawUnitCount: 0,
			persistentInstanceCount: 0,
			persistentStreamBytes: 0,
			persistentStreamCount: 0,
			sourcePartCount: prepared.sourcePartCount,
			sourceRangeCount: prepared.sourceRangeCount,
			sourceResidentCount: prepared.sourceResidentCount,
			sourceMaterialSlotCount: prepared.sourceMaterialSlotCount,
			transparentTemplateBytes: 0,
			transparentTemplateCohortCount: 0,
			transparentTemplateInstanceCount: 0,
			workerDurationMs: performance.now() - startedAt,
		},
	};
}

function prepareStaticSource(
	source: ResolvedStaticObjectLayerSource,
): PreparedStaticSource {
	const detailRole = staticObjectDetailRoleForSource(source);
	const parts: PreparedResidentPart[] = [];
	const sourceRangeIds = new Set<string>();
	const sourceMaterialSlotIds = new Set<string>();
	for (const resident of source.staticResidents) {
		const residentScale = createScaleMat4(resident.scale);
		const partTransforms = createPartTransforms(resident);
		for (const part of orderResolvedObjectParts(resident.presentation.parts)) {
			const partTransform = partTransforms.get(part.partIndex);
			if (!partTransform) {
				throw new Error(
					`Resident ${resident.id} has no default transform for part ${part.partIndex}.`,
				);
			}
			const sourceToLandblock = multiplyMat4(
				resident.placement.localTransform,
				residentScale,
			);
			multiplyMat4(sourceToLandblock, partTransform, sourceToLandblock);
			const contributions: SourceTriangleContribution[] = [];
			for (
				let triangle = 0;
				triangle < part.geometry.materialSlotIndices.length;
				triangle += 1
			) {
				const contribution = createSourceTriangleContribution({
					detailRole,
					geometry: part.geometry,
					part,
					partIndex: part.partIndex,
					triangle,
				});
				contributions.push(contribution);
				sourceRangeIds.add(
					`${resident.id}/part:${part.partIndex}/${contribution.bindingId}`,
				);
				const materialSlot = part.geometry.materialSlotIndices[triangle];
				if (materialSlot === undefined) {
					throw new Error(
						`Part ${part.partIndex} triangle ${triangle} has no material slot.`,
					);
				}
				sourceMaterialSlotIds.add(
					`${resident.id}/part:${part.partIndex}/material:${materialSlot}`,
				);
			}
			parts.push({
				contributions,
				geometryId: part.geometry.id,
				instanceAppearanceSupported: resident.appearance === null,
				partIndex: part.partIndex,
				residentId: resident.id,
				sourceToLandblock,
			});
		}
	}
	return {
		parts,
		sourcePartCount: parts.length,
		sourceResidentCount: source.staticResidents.length,
		sourceMaterialSlotCount: sourceMaterialSlotIds.size,
		sourceRangeCount: sourceRangeIds.size,
	};
}

interface InstancedGeometryPartition {
	readonly binding: StaticObjectMaterialBinding;
	readonly contributions: readonly SourceTriangleContribution[];
	readonly identity: string;
	readonly ordering: ObjectMaterialOrdering;
}

interface PersistentInstanceCohort {
	readonly instances: StaticInstanceData[];
	readonly partitionIdentities: Set<string>;
}

function prepareGeneratedStaticObjectGeometry(
	job: StaticObjectGeometryPreparationJob,
	prepared: PreparedStaticSource,
	startedAt: number,
): StaticObjectGeometryPreparationResult | null {
	if (prepared.parts.length === 0) return null;
	const instanceParts: PreparedResidentPart[] = [];
	const fallbackParts: PreparedResidentPart[] = [];
	for (const part of prepared.parts) {
		if (part.instanceAppearanceSupported && isInstanceEligibleTransform(part)) {
			instanceParts.push(part);
		} else {
			fallbackParts.push(part);
		}
	}
	const bakedFallback = prepareBakedStaticObjectGeometry(
		job,
		{
			parts: fallbackParts,
			sourceMaterialSlotCount: 0,
			sourcePartCount: 0,
			sourceRangeCount: 0,
			sourceResidentCount: 0,
		},
		startedAt,
		`${job.layer}-fallback`,
	);
	const partitions = new Map<string, InstancedGeometryPartition>();
	const persistentCohorts = new Map<string, PersistentInstanceCohort>();
	const transparentMembers: Array<{
		readonly instance: StaticInstanceData;
		readonly partitionIdentity: string;
		readonly residentId: string;
		readonly partIndex: number;
	}> = [];
	const bounds = emptyBounds();
	if (bakedFallback) bounds.union(bakedFallback.bounds);
	for (const part of instanceParts) {
		const instance = {
			color: { a: 1, b: 1, g: 1, r: 1 },
			sourceToLandblock: part.sourceToLandblock,
		};
		const persistentPartitionIdentities = new Set<string>();
		const contributionsByPartition = groupSourceContributions(part);
		for (const [identity, contributions] of contributionsByPartition) {
			const first = contributions[0];
			if (!first) continue;
			if (!partitions.has(identity)) {
				partitions.set(identity, {
					binding: first.binding,
					contributions,
					identity,
					ordering: first.ordering,
				});
			}
			expandTransformedContributionBounds(
				bounds,
				contributions,
				part.sourceToLandblock,
			);
			if (first.ordering === "transparent") {
				transparentMembers.push({
					instance,
					partIndex: part.partIndex,
					partitionIdentity: identity,
					residentId: part.residentId,
				});
			} else {
				persistentPartitionIdentities.add(identity);
			}
		}
		if (persistentPartitionIdentities.size > 0) {
			// Every draw referencing this stream must consume the exact same instance population.
			const cohortIdentity = JSON.stringify(
				[...persistentPartitionIdentities].sort(),
			);
			const persistent = persistentCohorts.get(cohortIdentity) ?? {
				instances: [],
				partitionIdentities: persistentPartitionIdentities,
			};
			persistent.instances.push(instance);
			persistentCohorts.set(cohortIdentity, persistent);
		}
	}
	if (partitions.size === 0) {
		if (!bakedFallback) return null;
		return {
			...bakedFallback,
			metrics: {
				...bakedFallback.metrics,
				sourceMaterialSlotCount: prepared.sourceMaterialSlotCount,
				sourcePartCount: prepared.sourcePartCount,
				sourceRangeCount: prepared.sourceRangeCount,
				sourceResidentCount: prepared.sourceResidentCount,
				workerDurationMs: performance.now() - startedAt,
			},
		};
	}
	assertFiniteBounds(bounds);

	const geometry: StaticObjectGeometryPreparationResult["geometry"][number][] =
		bakedFallback ? [...bakedFallback.geometry] : [];
	const partitionGeometryKeys = new Map<string, StaticGeometryKey>();
	const partitionGeometry = new Map<string, ObjectGeometryData>();
	let instancedGeometryBytes = 0;
	for (const partition of [...partitions.values()].sort((left, right) =>
		left.identity.localeCompare(right.identity),
	)) {
		const key =
			`static-source-geometry:${partition.identity}` as StaticGeometryKey;
		const data = createSourcePartitionGeometry(partition.contributions);
		geometry.push({ geometry: data, key });
		partitionGeometryKeys.set(partition.identity, key);
		partitionGeometry.set(partition.identity, data);
		instancedGeometryBytes += objectGeometryBytes(data);
	}

	const instanceStreams: StaticInstanceStreamSource[] = [];
	const drawUnits: StaticObjectDrawUnit[] = bakedFallback
		? [...bakedFallback.drawUnits]
		: [];
	let persistentInstanceCount = 0;
	for (const [index, [cohortIdentity, cohort]] of [
		...persistentCohorts.entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.entries()) {
		const streamKey =
			`static-instance-stream:${job.resourceNamespace}/cohort:${index}` as StaticInstanceStreamKey;
		instanceStreams.push({
			data: { instances: cohort.instances },
			key: streamKey,
		});
		persistentInstanceCount += cohort.instances.length;
		for (const partitionIdentity of [...cohort.partitionIdentities].sort()) {
			const partition = partitions.get(partitionIdentity);
			const geometryKey = partitionGeometryKeys.get(partitionIdentity);
			const geometryData = partitionGeometry.get(partitionIdentity);
			if (!partition || !geometryKey || !geometryData) {
				throw new Error(
					`Persistent cohort ${cohortIdentity} lost partition ${partitionIdentity}.`,
				);
			}
			drawUnits.push({
				geometry: geometryKey,
				indexCount: geometryData.indices.length,
				indexStart: 0,
				instances: streamKey,
				kind: "instanced",
				material: partition.binding,
				ordering: partition.ordering,
				transparentSort: null,
			});
		}
	}
	const frameStreamedInstances = transparentMembers.map(
		(member): FrameStreamedStaticInstanceTemplate => {
			const partition = partitions.get(member.partitionIdentity);
			const geometryKey = partitionGeometryKeys.get(member.partitionIdentity);
			const geometryData = partitionGeometry.get(member.partitionIdentity);
			if (!partition || !geometryKey || !geometryData) {
				throw new Error(
					`Transparent member ${member.residentId} lost partition ${member.partitionIdentity}.`,
				);
			}
			return {
				cohortKey: member.partitionIdentity,
				geometry: geometryKey,
				indexCount: geometryData.indices.length,
				indexStart: 0,
				instance: member.instance,
				material: partition.binding,
				transparentSort: {
					center: sourcePartitionCenter(partition.contributions),
					stableId: `${member.residentId}/part:${member.partIndex}/${member.partitionIdentity}`,
				},
			};
		},
	);
	return {
		bounds,
		drawUnits,
		frameStreamedInstances,
		geometry,
		instanceStreams,
		metrics: {
			bakedDrawUnitCount: bakedFallback?.metrics.bakedDrawUnitCount ?? 0,
			bakedGeometryBytes: bakedFallback?.metrics.bakedGeometryBytes ?? 0,
			instancedGeometryBytes,
			persistentCohortCount: persistentCohorts.size,
			persistentDrawUnitCount:
				drawUnits.length - (bakedFallback?.drawUnits.length ?? 0),
			persistentInstanceCount,
			persistentStreamBytes:
				persistentInstanceCount * STATIC_INSTANCE_RECORD_BYTES,
			persistentStreamCount: instanceStreams.length,
			sourcePartCount: prepared.sourcePartCount,
			sourceMaterialSlotCount: prepared.sourceMaterialSlotCount,
			sourceRangeCount: prepared.sourceRangeCount,
			sourceResidentCount: prepared.sourceResidentCount,
			transparentTemplateBytes:
				frameStreamedInstances.length *
				FRAME_STREAMED_STATIC_INSTANCE_TEMPLATE_BYTES,
			transparentTemplateCohortCount: new Set(
				frameStreamedInstances.map(({ cohortKey }) => cohortKey),
			).size,
			transparentTemplateInstanceCount: frameStreamedInstances.length,
			workerDurationMs: performance.now() - startedAt,
		},
	};
}

function groupSourceContributions(
	part: PreparedResidentPart,
): ReadonlyMap<string, SourceTriangleContribution[]> {
	const contributionsByContract = new Map<
		string,
		SourceTriangleContribution[]
	>();
	for (const contribution of part.contributions) {
		const contract = JSON.stringify([
			contribution.bindingId,
			contribution.ordering,
		]);
		const existing = contributionsByContract.get(contract);
		if (existing) existing.push(contribution);
		else contributionsByContract.set(contract, [contribution]);
	}
	const partitions = new Map<string, SourceTriangleContribution[]>();
	for (const [contract, contributions] of contributionsByContract) {
		// Binding equality is insufficient when two presentations select different triangle sets.
		const triangleMembership = contributions.map(
			({ sourceTriangleIndex }) => sourceTriangleIndex,
		);
		partitions.set(
			JSON.stringify([part.geometryId, contract, triangleMembership]),
			contributions,
		);
	}
	return partitions;
}

function createSourcePartitionGeometry(
	contributions: readonly SourceTriangleContribution[],
): ObjectGeometryData {
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	for (const contribution of contributions) {
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const positionOffset = vertex * 3;
			const textureOffset = vertex * 2;
			const index = positions.length / 3;
			positions.push(
				contribution.positions[positionOffset]!,
				contribution.positions[positionOffset + 1]!,
				contribution.positions[positionOffset + 2]!,
			);
			normals.push(
				contribution.normals[positionOffset]!,
				contribution.normals[positionOffset + 1]!,
				contribution.normals[positionOffset + 2]!,
			);
			textureCoordinates.push(
				contribution.textureCoordinates[textureOffset]!,
				contribution.textureCoordinates[textureOffset + 1]!,
			);
			indices.push(index);
		}
	}
	return {
		indices: Uint32Array.from(indices),
		kind: "object",
		normals: Float32Array.from(normals),
		positions: Float32Array.from(positions),
		textureCoordinates: Float32Array.from(textureCoordinates),
	};
}

function expandTransformedContributionBounds(
	bounds: AABB3,
	contributions: readonly SourceTriangleContribution[],
	sourceToLandblock: Mat4,
): void {
	const point = Vec3.zero();
	for (const contribution of contributions) {
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const offset = vertex * 3;
			point.x = contribution.positions[offset]!;
			point.y = contribution.positions[offset + 1]!;
			point.z = contribution.positions[offset + 2]!;
			transformPoint3(sourceToLandblock, point, point);
			assertFiniteComponents(point.x, point.y, point.z, "instanced position");
			expandBounds(bounds, point.x, point.y, point.z);
		}
	}
}

function sourcePartitionCenter(
	contributions: readonly SourceTriangleContribution[],
): Vec3 {
	const center = Vec3.zero();
	let pointCount = 0;
	for (const contribution of contributions) {
		for (let offset = 0; offset < contribution.positions.length; offset += 3) {
			center.x += contribution.positions[offset]!;
			center.y += contribution.positions[offset + 1]!;
			center.z += contribution.positions[offset + 2]!;
			pointCount += 1;
		}
	}
	if (pointCount === 0) throw new Error("Static geometry partition is empty.");
	center.x /= pointCount;
	center.y /= pointCount;
	center.z /= pointCount;
	return center;
}

function objectGeometryBytes(geometry: ObjectGeometryData): number {
	return (
		geometry.positions.byteLength +
		geometry.normals.byteLength +
		geometry.textureCoordinates.byteLength +
		geometry.indices.byteLength
	);
}

/**
 * Accept affine rotation/reflection plus uniform scale, fall back for other finite transforms,
 * and reject singular/non-finite transforms that cannot produce valid positions and normals.
 */
function isInstanceEligibleTransform(part: PreparedResidentPart): boolean {
	const matrix = part.sourceToLandblock;
	const values = [
		matrix.m11,
		matrix.m12,
		matrix.m13,
		matrix.m14,
		matrix.m21,
		matrix.m22,
		matrix.m23,
		matrix.m24,
		matrix.m31,
		matrix.m32,
		matrix.m33,
		matrix.m34,
		matrix.m41,
		matrix.m42,
		matrix.m43,
		matrix.m44,
	];
	if (!values.every(Number.isFinite)) {
		throw new Error(
			`Resident ${part.residentId} has a non-finite instance transform.`,
		);
	}
	const x = [matrix.m11, matrix.m12, matrix.m13] as const;
	const y = [matrix.m21, matrix.m22, matrix.m23] as const;
	const z = [matrix.m31, matrix.m32, matrix.m33] as const;
	const lengths = [
		Math.hypot(...x),
		Math.hypot(...y),
		Math.hypot(...z),
	] as const;
	const maximumLength = Math.max(...lengths);
	const singularTolerance = Math.max(maximumLength, 1) * Number.EPSILON * 16;
	if (lengths.some((length) => length <= singularTolerance)) {
		throw new Error(
			`Resident ${part.residentId} has a singular instance transform.`,
		);
	}
	const scaleTolerance = Math.max(maximumLength * 1e-5, Number.EPSILON);
	const affineTolerance = 1e-5;
	const dotTolerance = maximumLength * maximumLength * 1e-5;
	const dot = (left: readonly number[], right: readonly number[]) =>
		left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
	return !(
		maximumLength - Math.min(...lengths) > scaleTolerance ||
		Math.abs(dot(x, y)) > dotTolerance ||
		Math.abs(dot(x, z)) > dotTolerance ||
		Math.abs(dot(y, z)) > dotTolerance ||
		Math.abs(matrix.m14) > affineTolerance ||
		Math.abs(matrix.m24) > affineTolerance ||
		Math.abs(matrix.m34) > affineTolerance ||
		Math.abs(matrix.m44 - 1) > affineTolerance
	);
}

function createSourceTriangleContribution(options: {
	readonly detailRole: StaticDetailRole | null;
	readonly geometry: ResolvedGeometry;
	readonly part: ResolvedObjectPart;
	readonly partIndex: number;
	readonly triangle: number;
}): SourceTriangleContribution {
	const { binding, bindingId, ordering } = resolveStaticTriangleMaterial({
		detailRole: options.detailRole,
		geometry: options.geometry,
		materials: options.part.materials,
		sourceLabel: `Part ${options.partIndex}`,
		triangle: options.triangle,
	});
	const indexStart = options.triangle * 3;
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const sourcePosition = Vec3.zero();
	const sourceNormal = Vec3.zero();
	for (let vertex = 0; vertex < 3; vertex += 1) {
		const sourceIndex = options.geometry.indices[indexStart + vertex];
		if (sourceIndex === undefined) {
			throw new Error(
				`Triangle ${options.triangle} has an incomplete index range.`,
			);
		}
		const positionOffset = sourceIndex * 3;
		const textureOffset = sourceIndex * 2;
		sourcePosition.x = options.geometry.positions[positionOffset]!;
		sourcePosition.y = options.geometry.positions[positionOffset + 1]!;
		sourcePosition.z = options.geometry.positions[positionOffset + 2]!;
		sourceNormal.x = options.geometry.normals[positionOffset]!;
		sourceNormal.y = options.geometry.normals[positionOffset + 1]!;
		sourceNormal.z = options.geometry.normals[positionOffset + 2]!;
		positions.push(sourcePosition.x, sourcePosition.y, sourcePosition.z);
		normals.push(sourceNormal.x, sourceNormal.y, sourceNormal.z);
		textureCoordinates.push(
			options.geometry.textureCoordinates[textureOffset]!,
			options.geometry.textureCoordinates[textureOffset + 1]!,
		);
	}
	return {
		binding,
		bindingId,
		normals,
		ordering,
		positions,
		sourceTriangleIndex: options.triangle,
		textureCoordinates,
	};
}

function transformTriangleContribution(
	source: SourceTriangleContribution,
	sourceToLandblock: Mat4,
	residentId: string,
	partIndex: number,
): BakedTriangleContribution {
	const positions: number[] = [];
	const normals: number[] = [];
	const position = Vec3.zero();
	const normal = Vec3.zero();
	for (let vertex = 0; vertex < 3; vertex += 1) {
		const offset = vertex * 3;
		position.x = source.positions[offset]!;
		position.y = source.positions[offset + 1]!;
		position.z = source.positions[offset + 2]!;
		normal.x = source.normals[offset]!;
		normal.y = source.normals[offset + 1]!;
		normal.z = source.normals[offset + 2]!;
		transformPoint3(sourceToLandblock, position, position);
		transformNormal3(sourceToLandblock, normal, normal);
		positions.push(position.x, position.y, position.z);
		normals.push(normal.x, normal.y, normal.z);
	}
	return {
		...source,
		normals,
		positions,
		transparentStableId:
			source.ordering === "transparent"
				? `${residentId}/part:${partIndex}/${source.bindingId}`
				: null,
	};
}

function createPartTransforms(
	resident: ResolvedStaticObjectLayerSource["staticResidents"][number],
): ReadonlyMap<number, Mat4> {
	const pose = resident.presentation.placementPoses.get(0);
	if (!pose)
		throw new Error(`Resident ${resident.id} has no default placement pose.`);
	return resolveObjectPartTransforms(
		resident.presentation.parts,
		pose.partTransforms,
	);
}

function compareGroups(
	left: ContributionGroup,
	right: ContributionGroup,
): number {
	const order = orderingRank(left.ordering) - orderingRank(right.ordering);
	if (order !== 0) return order;
	return (left.transparentStableId ?? left.bindingId).localeCompare(
		right.transparentStableId ?? right.bindingId,
	);
}

function orderingRank(ordering: ObjectMaterialOrdering): number {
	return ["opaque", "alpha-test", "transparent", "additive"].indexOf(ordering);
}

function emptyBounds(): AABB3 {
	return new AABB3(
		new Vec3(
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
		),
		new Vec3(
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		),
	);
}

function expandBounds(bounds: AABB3, x: number, y: number, z: number): void {
	bounds.min.x = Math.min(bounds.min.x, x);
	bounds.min.y = Math.min(bounds.min.y, y);
	bounds.min.z = Math.min(bounds.min.z, z);
	bounds.max.x = Math.max(bounds.max.x, x);
	bounds.max.y = Math.max(bounds.max.y, y);
	bounds.max.z = Math.max(bounds.max.z, z);
}

function assertBounds(bounds: AABB3, positions: readonly number[]): void {
	assertFiniteBounds(bounds);
	for (let offset = 0; offset < positions.length; offset += 3) {
		const point = new Vec3(
			positions[offset]!,
			positions[offset + 1]!,
			positions[offset + 2]!,
		);
		if (
			point.x < bounds.min.x ||
			point.x > bounds.max.x ||
			point.y < bounds.min.y ||
			point.y > bounds.max.y ||
			point.z < bounds.min.z ||
			point.z > bounds.max.z
		) {
			throw new Error(
				"Baked static-object bounds do not contain a baked position.",
			);
		}
	}
}

function assertFiniteBounds(bounds: AABB3): void {
	if (
		!Number.isFinite(bounds.min.x) ||
		!Number.isFinite(bounds.min.y) ||
		!Number.isFinite(bounds.min.z) ||
		!Number.isFinite(bounds.max.x) ||
		!Number.isFinite(bounds.max.y) ||
		!Number.isFinite(bounds.max.z) ||
		bounds.min.x > bounds.max.x ||
		bounds.min.y > bounds.max.y ||
		bounds.min.z > bounds.max.z
	) {
		throw new Error("Static-object bounds are invalid.");
	}
}

function assertFiniteComponents(
	x: number,
	y: number,
	z: number,
	label: string,
): void {
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		throw new Error(`Static object ${label} is not finite.`);
	}
}

/** Reject mismatched source provenance before it can allocate into the wrong layer domain. */
function assertJobLayer(job: StaticObjectGeometryPreparationJob): void {
	if (job.source.kind !== job.layer) {
		throw new Error(
			`Static-object geometry layer ${job.layer} does not match source layer ${job.source.kind}.`,
		);
	}
}
