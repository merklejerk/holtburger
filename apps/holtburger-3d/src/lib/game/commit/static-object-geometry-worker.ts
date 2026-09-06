import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import {
	staticObjectDetailRoleForSource,
	type StaticDetailRole,
} from "../resolution/static-detail-role";
import {
	residentKey,
	type ResolvedStaticObjectLayerSource,
} from "../resolution/landblock-layer";
import {
	type ResolvedGeometry,
	type ResolvedObjectPart,
	RESTING_PLACEMENT_KEY,
	resolvePlacementPose,
} from "../resolution/presentation";
import {
	multiplyMat4,
	transformNormal3,
	transformPoint3,
} from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { landblockVec3, type LandblockVec3 } from "../../assets/ac-frame";
import type { ObjectGeometryData } from "../renderer/geometry";
import { bakeStaticLight } from "./interior-static-lighting";
import type { StaticGeometryKey } from "../geometry/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	StaticInstallResourceNamespace,
	ObjectInstanceData,
} from "../systems/static-resources";
import type {
	FrameStreamedObjectInstanceTemplate,
	StaticObjectDrawUnit,
	ObjectMaterialBinding,
} from "./artifacts";
import { FRAME_STREAMED_OBJECT_INSTANCE_TEMPLATE_BYTES } from "./artifacts";
import { resolveObjectTriangleMaterial } from "./object-material-binding";
import { composeObjectPartTransform } from "../resolution/object-part-transform";

/** One closed geometry job containing no runtime, device, or atlas callbacks. */
export interface StaticObjectGeometryPreparationJob {
	/** Typed source layer keeps geometry identities and later publication domains distinct. */
	readonly layer: ResolvedStaticObjectLayerSource["kind"];
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly source: ResolvedStaticObjectLayerSource;
}

/** Immutable material range emitted by the geometry worker. */
interface BakedStaticObjectRange {
	/** Dense row published with the geometry's vertex material selectors. */
	readonly materialSelector: number;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	readonly retailVisibility: ResolvedObjectPart["retailVisibility"];
	/** Stable sorter input exists only for transparent ranges; centers are landblock space. */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: LandblockVec3;
	} | null;
}

/** Complete strategy-neutral geometry result returned by the closed worker. */
export interface StaticObjectGeometryPreparationResult {
	readonly geometry: readonly {
		readonly key: StaticGeometryKey;
		readonly geometry: ObjectGeometryData;
	}[];
	/** Independently cullable render objects sharing this result's immutable resources. */
	readonly objects: readonly StaticObjectGeometryRenderObject[];
	readonly metrics: {
		readonly sourceResidentCount: number;
		readonly sourcePartCount: number;
		/** Resident/part/material-slot submissions before polygon-side facts split a range. */
		readonly sourceMaterialSlotCount: number;
		/** Resident/part/complete-binding submissions before permitted baking merges. */
		readonly sourceRangeCount: number;
		readonly bakedDrawUnitCount: number;
		readonly bakedGeometryBytes: number;
		/** Bytes of shared template source geometry, instanced per frame by the residue. */
		readonly instancedGeometryBytes: number;
		readonly transparentTemplateCohortCount: number;
		readonly transparentTemplateInstanceCount: number;
		readonly transparentTemplateBytes: number;
		/** Wall-clock algorithm time measured inside the worker boundary. */
		readonly workerDurationMs: number;
	};
}

/** One worker-produced static object whose tight bounds own its complete render contribution. */
interface StaticObjectGeometryRenderObject {
	readonly bounds: AABB3;
	readonly drawUnits: readonly StaticObjectDrawUnit[];
	readonly frameStreamedInstances: readonly FrameStreamedObjectInstanceTemplate[];
}

interface SourceTriangleContribution {
	readonly binding: ObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	readonly retailVisibility: ResolvedObjectPart["retailVisibility"];
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
	readonly binding: ObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	readonly retailVisibility: ResolvedObjectPart["retailVisibility"];
	readonly triangles: BakedTriangleContribution[];
	readonly transparentStableId: string | null;
}

interface PreparedResidentPart {
	readonly contributions: readonly SourceTriangleContribution[];
	readonly geometryId: ResolvedGeometry["id"];
	/** Unresolved substitutions require the explicit baked path until resolution owns them. */
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
	if (job.layer === LandblockLayerKind.Generated) {
		return prepareGeneratedSceneryGeometry(job, prepared, startedAt);
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
			const groupKey = JSON.stringify([
				contribution.retailVisibility,
				contribution.transparentStableId ?? contribution.bindingId,
			]);
			const existing = groups.get(groupKey);
			if (existing) {
				existing.triangles.push(contribution);
				continue;
			}
			groups.set(groupKey, {
				binding: contribution.binding,
				bindingId: contribution.bindingId,
				ordering: contribution.ordering,
				retailVisibility: contribution.retailVisibility,
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
	const materialSelectors: number[] = [];
	const bounds = emptyBounds();
	for (const group of sortedGroups) {
		const materialSelector = ranges.length;
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
				materialSelectors.push(materialSelector);
			}
		}
		const transparentSort =
			group.transparentStableId === null
				? null
				: {
						// Merged baked contributions are already in landblock space, so their
						// centroid is too and needs no placement transform here or per frame.
						center: landblockVec3(
							new Vec3(
								center.x / centerPointCount,
								center.y / centerPointCount,
								center.z / centerPointCount,
							),
						),
						stableId: group.transparentStableId,
					};
		ranges.push({
			materialSelector,
			indexCount: indices.length - indexStart,
			indexStart,
			material: group.binding,
			ordering: group.ordering,
			retailVisibility: group.retailVisibility,
			transparentSort,
		});
	}
	assertBounds(bounds, positions);
	const mergedPositions = Float32Array.from(positions);
	const mergedNormals = Float32Array.from(normals);
	const geometry: ObjectGeometryData = {
		materials: {
			selectors: Uint32Array.from(materialSelectors),
			count: ranges.length,
		},
		// Merged contributions are already in landblock space, which is the space the lights
		// were placed in, so the bake needs no further transform.
		bakedLight: bakeStaticLight(
			mergedPositions,
			mergedNormals,
			Mat4.identity(),
			// Only EnvCell sources bake. Outdoor geometry receives its authored lights through
			// the runtime set instead, because emitters and receivers sit in layers with
			// independent residency radii and cannot be resolved together here.
			job.source.kind === LandblockLayerKind.EnvCells
				? job.source.staticLights
				: [],
		),
		indices: Uint32Array.from(indices),
		kind: "object",
		normals: mergedNormals,
		positions: mergedPositions,
		textureCoordinates: Float32Array.from(textureCoordinates),
	};
	const geometryKey =
		`static-install-geometry:${job.resourceNamespace}/${keySuffix}` as StaticGeometryKey;
	return {
		geometry: [{ geometry, key: geometryKey }],
		objects: [
			{
				bounds,
				drawUnits: ranges.map((range) => ({
					materialSelector: range.materialSelector,
					geometry: geometryKey,
					indexCount: range.indexCount,
					indexStart: range.indexStart,
					kind: "baked" as const,
					material: range.material,
					ordering: range.ordering,
					retailVisibility: range.retailVisibility,
					transparentSort: range.transparentSort,
				})),
				frameStreamedInstances: [],
			},
		],
		metrics: {
			bakedDrawUnitCount: ranges.length,
			bakedGeometryBytes:
				materialSelectors.length * Uint32Array.BYTES_PER_ELEMENT +
				geometry.positions.byteLength +
				geometry.normals.byteLength +
				geometry.textureCoordinates.byteLength +
				geometry.indices.byteLength,
			instancedGeometryBytes: 0,
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
		const restingPose = resolvePlacementPose(
			resident.presentation,
			RESTING_PLACEMENT_KEY,
		);
		for (const part of resident.presentation.parts) {
			const partTransform = restingPose.partTransforms[part.partIndex];
			if (!partTransform) {
				throw new Error(
					`Resident ${residentKey(resident.identity)} has no resting transform for part ${part.partIndex}.`,
				);
			}
			const sourceToLandblock = multiplyMat4(
				resident.placement.localTransform,
				composeObjectPartTransform(
					partTransform,
					resident.scale,
					part.defaultScale,
				),
			);
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
					`${residentKey(resident.identity)}/part:${part.partIndex}/${contribution.bindingId}`,
				);
				const materialSlot = part.geometry.materialSlotIndices[triangle];
				if (materialSlot === undefined) {
					throw new Error(
						`Part ${part.partIndex} triangle ${triangle} has no material slot.`,
					);
				}
				sourceMaterialSlotIds.add(
					`${residentKey(resident.identity)}/part:${part.partIndex}/material:${materialSlot}`,
				);
			}
			parts.push({
				contributions,
				geometryId: part.geometry.id,
				partIndex: part.partIndex,
				residentId: residentKey(resident.identity),
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

/** One shared transparent-template geometry partition, provably transparent-ordered. */
interface TemplateGeometryPartition {
	readonly binding: ObjectMaterialBinding;
	readonly contributions: readonly SourceTriangleContribution[];
	readonly identity: string;
	readonly retailVisibility: ResolvedObjectPart["retailVisibility"];
}

/** A template partition with its realized shared geometry and per-partition sort centre. */
interface RealizedTemplatePartition {
	/** Draw constants shared by the partition's independently ordered instances. */
	readonly draw: FrameStreamedObjectInstanceTemplate["draw"];
	readonly center: Vec3;
}

/**
 * Generated scenery hybrid: order-independent contributions bake into this landblock layer's
 * merged static buffer exactly like buildings, so their per-frame cost is a handful of baked
 * range draws instead of per-instance selection, grouping, and upload. Only the transparent
 * contributions of instance-eligible parts stay per-instance, as frame-streamed templates, so
 * the near/far transparency ordering pipeline keeps its guarantees bit-for-bit.
 *
 * Transform-ineligible parts bake wholly — the baked path emits their transparent triangles as
 * sorted transparent ranges, exactly as it always has for buildings. Additive contributions
 * bake too: additive blending commutes, and baked additive ranges are the same mechanism
 * buildings already render with.
 */
function prepareGeneratedSceneryGeometry(
	job: StaticObjectGeometryPreparationJob,
	prepared: PreparedStaticSource,
	startedAt: number,
): StaticObjectGeometryPreparationResult | null {
	if (prepared.parts.length === 0) return null;
	const bakedParts: PreparedResidentPart[] = [];
	const templateParts: PreparedResidentPart[] = [];
	for (const part of prepared.parts) {
		if (!isInstanceEligibleTransform(part)) {
			bakedParts.push(part);
			continue;
		}
		const baked = part.contributions.filter(
			(contribution) => contribution.ordering !== "transparent",
		);
		const templated = part.contributions.filter(
			(contribution) => contribution.ordering === "transparent",
		);
		if (baked.length > 0) bakedParts.push({ ...part, contributions: baked });
		if (templated.length > 0) {
			templateParts.push({ ...part, contributions: templated });
		}
	}
	const baked = prepareBakedStaticObjectGeometry(
		job,
		{
			parts: bakedParts,
			sourceMaterialSlotCount: 0,
			sourcePartCount: 0,
			sourceRangeCount: 0,
			sourceResidentCount: 0,
		},
		startedAt,
	);
	const bakedObject = baked?.objects[0] ?? null;
	if (baked && !bakedObject) {
		throw new Error("Generated baked output has no render object.");
	}
	const partitions = new Map<string, TemplateGeometryPartition>();
	const templateMembers: Array<{
		readonly instance: ObjectInstanceData;
		readonly partitionIdentity: string;
		readonly residentId: string;
		readonly partIndex: number;
	}> = [];
	const bounds = emptyBounds();
	if (bakedObject) bounds.union(bakedObject.bounds);
	for (const part of templateParts) {
		const instance = {
			color: { a: 1, b: 1, g: 1, r: 1 },
			sourceToLandblock: part.sourceToLandblock,
		};
		for (const [identity, contributions] of groupSourceContributions(part)) {
			const first = contributions[0];
			if (!first) continue;
			if (!partitions.has(identity)) {
				partitions.set(identity, {
					binding: first.binding,
					contributions,
					identity,
					retailVisibility: first.retailVisibility,
				});
			}
			expandTransformedContributionBounds(
				bounds,
				contributions,
				part.sourceToLandblock,
			);
			templateMembers.push({
				instance,
				partIndex: part.partIndex,
				partitionIdentity: identity,
				residentId: part.residentId,
			});
		}
	}
	if (partitions.size === 0) {
		if (!baked) return null;
		return {
			...baked,
			metrics: {
				...baked.metrics,
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
		baked ? [...baked.geometry] : [];
	const realized = new Map<string, RealizedTemplatePartition>();
	let instancedGeometryBytes = 0;
	for (const partition of [...partitions.values()].sort((left, right) =>
		left.identity.localeCompare(right.identity),
	)) {
		const data = createSourcePartitionGeometry(partition.contributions);
		const key =
			`static-source-geometry:${partition.identity}` as StaticGeometryKey;
		geometry.push({ geometry: data, key });
		realized.set(partition.identity, {
			draw: {
				cohortKey: partition.identity,
				geometry: key,
				indexCount: data.indices.length,
				indexStart: 0,
				material: partition.binding,
				retailVisibility: partition.retailVisibility,
			},
			center: sourcePartitionCenter(partition.contributions),
		});
		instancedGeometryBytes += objectGeometryBytes(data);
	}
	const frameStreamedInstances = templateMembers.map(
		(member): FrameStreamedObjectInstanceTemplate => {
			const partition = realized.get(member.partitionIdentity);
			if (!partition) {
				throw new Error(
					`Transparent member ${member.residentId} lost partition ${member.partitionIdentity}.`,
				);
			}
			return {
				draw: partition.draw,
				instance: member.instance,
				transparentSort: {
					// The partition's center is shared source-local geometry, but a template's sort
					// center must be landblock space. This instance's placement never changes, so
					// the transform belongs here rather than in every frame that orders it.
					center: landblockVec3(
						transformPoint3(
							member.instance.sourceToLandblock,
							partition.center,
						),
					),
					stableId: `${member.residentId}/part:${member.partIndex}/${member.partitionIdentity}`,
				},
			};
		},
	);
	return {
		geometry,
		objects: [
			{
				bounds,
				drawUnits: bakedObject ? [...bakedObject.drawUnits] : [],
				frameStreamedInstances,
			},
		],
		metrics: {
			bakedDrawUnitCount: baked?.metrics.bakedDrawUnitCount ?? 0,
			bakedGeometryBytes: baked?.metrics.bakedGeometryBytes ?? 0,
			instancedGeometryBytes,
			sourceMaterialSlotCount: prepared.sourceMaterialSlotCount,
			sourcePartCount: prepared.sourcePartCount,
			sourceRangeCount: prepared.sourceRangeCount,
			sourceResidentCount: prepared.sourceResidentCount,
			transparentTemplateBytes:
				frameStreamedInstances.length *
				FRAME_STREAMED_OBJECT_INSTANCE_TEMPLATE_BYTES,
			transparentTemplateCohortCount: partitions.size,
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
			contribution.retailVisibility,
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
		// Instanced partitions are outdoor generated scenery, which authors no static lights.
		bakedLight: null,
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

/** Expand a cohort envelope from worker-owned source geometry without device reconstruction. */

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
	const { binding, bindingId, ordering } = resolveObjectTriangleMaterial({
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
		retailVisibility: options.part.retailVisibility,
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

function compareGroups(
	left: ContributionGroup,
	right: ContributionGroup,
): number {
	const order = orderingRank(left.ordering) - orderingRank(right.ordering);
	if (order !== 0) return order;
	const visibility = left.retailVisibility.localeCompare(
		right.retailVisibility,
	);
	if (visibility !== 0) return visibility;
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
