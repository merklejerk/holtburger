import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import type {
	ResolvedGeometry,
	ResolvedObjectPart,
} from "../resolution/presentation";
import { multiplyMat4, transformPoint3 } from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { StaticObjectMaterialBinding } from "./artifacts";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { StaticGeometryKey } from "../geometry/types";
import { TextureWrapMode } from "../textures/types";

/** One closed geometry job containing no runtime, device, or atlas callbacks. */
export interface BuildingGeometryJob {
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly source: ResolvedObjectLayerSource;
}

/** Immutable material range emitted by the geometry worker. */
export interface BakedBuildingRange {
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

/** Complete single-allocation geometry result returned by the closed worker. */
export interface BuildingGeometryResult {
	readonly geometry: {
		readonly key: StaticGeometryKey;
		readonly geometry: ObjectGeometryData;
	};
	readonly bounds: AABB3;
	readonly ranges: readonly BakedBuildingRange[];
	readonly metrics: {
		/** Resident/part/material-slot submissions before polygon-side facts split a range. */
		readonly sourceMaterialSlotCount: number;
		/** Resident/part/complete-binding submissions before permitted baking merges. */
		readonly sourceRangeCount: number;
		readonly bakedRangeCount: number;
		readonly transparentRangeCount: number;
		readonly additiveRangeCount: number;
		/** Wall-clock algorithm time measured inside the worker boundary. */
		readonly workerDurationMs: number;
		readonly geometryBytes: number;
	};
}

interface TriangleContribution {
	readonly binding: StaticObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	readonly positions: readonly Vec3[];
	readonly normals: readonly Vec3[];
	readonly textureCoordinates: readonly number[];
	readonly transparentStableId: string | null;
}

interface ContributionGroup {
	readonly binding: StaticObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ObjectMaterialOrdering;
	readonly triangles: TriangleContribution[];
	readonly transparentStableId: string | null;
}

/**
 * Bake all static residents into one landblock-local allocation. This function is deliberately
 * closed: it receives every source and material fact before execution and never asks callers for
 * device state, texture placement, or additional residency.
 */
export function bakeBuildingGeometry(
	job: BuildingGeometryJob,
): BuildingGeometryResult | null {
	const startedAt = performance.now();
	const groups = new Map<string, ContributionGroup>();
	const sourceRangeIds = new Set<string>();
	const sourceMaterialSlotIds = new Set<string>();
	for (const resident of job.source.staticResidents) {
		const partTransforms = createPartTransforms(resident);
		for (const part of resident.presentation.parts) {
			const partTransform = partTransforms.get(part.partIndex);
			if (!partTransform) {
				throw new Error(
					`Resident ${resident.id} has no default transform for part ${part.partIndex}.`,
				);
			}
			const sourceToLandblock = multiplyMat4(
				multiplyMat4(
					resident.placement.localTransform,
					scaleMat4(resident.scale),
				),
				partTransform,
			);
			for (
				let triangle = 0;
				triangle < part.geometry.materialSlotIndices.length;
				triangle += 1
			) {
				const contribution = createTriangleContribution({
					geometry: part.geometry,
					part,
					residentId: resident.id,
					partIndex: part.partIndex,
					sourceToLandblock,
					triangle,
				});
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
	}
	if (groups.size === 0) return null;

	const sortedGroups = [...groups.values()].sort(compareGroups);
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	const ranges: BakedBuildingRange[] = [];
	const bounds = emptyBounds();
	for (const group of sortedGroups) {
		const indexStart = indices.length;
		const center = Vec3.zero();
		let centerPointCount = 0;
		for (const triangle of group.triangles) {
			for (let vertex = 0; vertex < 3; vertex += 1) {
				const point = triangle.positions[vertex]!;
				const normal = triangle.normals[vertex]!;
				assertFinite(point, "baked position");
				assertFinite(normal, "baked normal");
				expandBounds(bounds, point);
				center.x += point.x;
				center.y += point.y;
				center.z += point.z;
				centerPointCount += 1;
				const index = positions.length / 3;
				positions.push(point.x, point.y, point.z);
				normals.push(normal.x, normal.y, normal.z);
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
	return {
		bounds,
		geometry: {
			geometry,
			key: `static-install-geometry:${job.resourceNamespace}/building-layer` as StaticGeometryKey,
		},
		metrics: {
			additiveRangeCount: ranges.filter(
				(range) => range.ordering === "additive",
			).length,
			bakedRangeCount: ranges.length,
			geometryBytes:
				geometry.positions.byteLength +
				geometry.normals.byteLength +
				geometry.textureCoordinates.byteLength +
				geometry.indices.byteLength,
			sourceRangeCount: sourceRangeIds.size,
			sourceMaterialSlotCount: sourceMaterialSlotIds.size,
			transparentRangeCount: ranges.filter(
				(range) => range.transparentSort !== null,
			).length,
			workerDurationMs: performance.now() - startedAt,
		},
		ranges,
	};
}

function createTriangleContribution(options: {
	readonly geometry: ResolvedGeometry;
	readonly part: ResolvedObjectPart;
	readonly residentId: string;
	readonly partIndex: number;
	readonly sourceToLandblock: Mat4;
	readonly triangle: number;
}): TriangleContribution {
	const slot = options.geometry.materialSlotIndices[options.triangle];
	const material = options.part.materials[slot ?? -1];
	if (!material) {
		throw new Error(
			`Part ${options.partIndex} triangle ${options.triangle} has no material slot ${slot}.`,
		);
	}
	const wrap =
		options.geometry.materialWrapModes[options.triangle] === 1
			? TextureWrapMode.Repeat
			: TextureWrapMode.Clamp;
	const plan = planObjectMaterial(material, wrap);
	const sideKind = options.geometry.materialSideKinds[options.triangle];
	const sideType = options.geometry.materialSideTypes[options.triangle];
	const stippling = options.geometry.materialStippling[options.triangle];
	if (
		sideKind === undefined ||
		sideType === undefined ||
		stippling === undefined
	) {
		throw new Error(`Triangle ${options.triangle} is missing polygon facts.`);
	}
	const polygon = {
		cullMode: cullMode(sideType),
		renderSide: renderSide(sideKind),
		stippled: (stippling & (sideKind === 2 ? 0x02 : 0x01)) !== 0,
	} as const;
	const binding: StaticObjectMaterialBinding = {
		palettedClipMap: plan.palettedClipMap,
		polygon,
		sampler: plan.sampler,
		source: material,
		textures: { base: plan.baseTexture, palette: plan.paletteTexture },
	};
	const bindingId = [
		plan.id,
		polygon.cullMode,
		polygon.renderSide,
		polygon.stippled,
	].join("|");
	const indexStart = options.triangle * 3;
	const positions: Vec3[] = [];
	const normals: Vec3[] = [];
	const textureCoordinates: number[] = [];
	for (let vertex = 0; vertex < 3; vertex += 1) {
		const sourceIndex = options.geometry.indices[indexStart + vertex];
		if (sourceIndex === undefined) {
			throw new Error(
				`Triangle ${options.triangle} has an incomplete index range.`,
			);
		}
		const positionOffset = sourceIndex * 3;
		const textureOffset = sourceIndex * 2;
		const sourcePosition = new Vec3(
			options.geometry.positions[positionOffset]!,
			options.geometry.positions[positionOffset + 1]!,
			options.geometry.positions[positionOffset + 2]!,
		);
		const sourceNormal = new Vec3(
			options.geometry.normals[positionOffset]!,
			options.geometry.normals[positionOffset + 1]!,
			options.geometry.normals[positionOffset + 2]!,
		);
		positions.push(transformPoint3(options.sourceToLandblock, sourcePosition));
		normals.push(transformNormal(options.sourceToLandblock, sourceNormal));
		textureCoordinates.push(
			options.geometry.textureCoordinates[textureOffset]!,
			options.geometry.textureCoordinates[textureOffset + 1]!,
		);
	}
	return {
		binding,
		bindingId,
		normals,
		ordering: plan.ordering,
		positions,
		textureCoordinates,
		transparentStableId:
			plan.ordering === "transparent"
				? `${options.residentId}/part:${options.partIndex}/${bindingId}`
				: null,
	};
}

function createPartTransforms(
	resident: ResolvedObjectLayerSource["staticResidents"][number],
): ReadonlyMap<number, Mat4> {
	const pose = resident.presentation.placementPoses.get(0);
	if (!pose)
		throw new Error(`Resident ${resident.id} has no default placement pose.`);
	const transforms = new Map<number, Mat4>();
	const pending = new Map(
		resident.presentation.parts.map((part) => [part.partIndex, part]),
	);
	while (pending.size > 0) {
		let progressed = false;
		for (const [partIndex, part] of pending) {
			const localTransform = pose.partTransforms[partIndex];
			if (!localTransform) {
				throw new Error(
					`Resident ${resident.id} has no transform for part ${partIndex}.`,
				);
			}
			if (
				part.parentPartIndex !== null &&
				!transforms.has(part.parentPartIndex)
			)
				continue;
			const parent =
				part.parentPartIndex === null
					? null
					: transforms.get(part.parentPartIndex);
			transforms.set(
				partIndex,
				parent ? multiplyMat4(parent, localTransform) : localTransform,
			);
			pending.delete(partIndex);
			progressed = true;
		}
		if (!progressed)
			throw new Error(`Resident ${resident.id} has a cyclic part hierarchy.`);
	}
	return transforms;
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

function cullMode(
	value: number,
): StaticObjectMaterialBinding["polygon"]["cullMode"] {
	switch (value) {
		case 0:
			return "single";
		case 1:
			return "double";
		case 2:
			return "both";
		case 3:
			return "counter-clockwise";
		default:
			throw new Error(`Unsupported polygon culling mode ${value}.`);
	}
}

function renderSide(
	value: number,
): StaticObjectMaterialBinding["polygon"]["renderSide"] {
	switch (value) {
		case 0:
			return "positive";
		case 1:
			return "positive-reversed";
		case 2:
			return "negative";
		default:
			throw new Error(`Unsupported polygon render side ${value}.`);
	}
}

function scaleMat4(scale: Vec3): Mat4 {
	return new Mat4(
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
	);
}

function transformNormal(matrix: Mat4, normal: Vec3): Vec3 {
	const a = matrix.m11;
	const b = matrix.m21;
	const c = matrix.m31;
	const d = matrix.m12;
	const e = matrix.m22;
	const f = matrix.m32;
	const g = matrix.m13;
	const h = matrix.m23;
	const i = matrix.m33;
	const determinant =
		a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (!Number.isFinite(determinant) || determinant === 0) {
		throw new Error("Cannot bake normals through a singular transform.");
	}
	const x =
		((e * i - f * h) * normal.x +
			(f * g - d * i) * normal.y +
			(d * h - e * g) * normal.z) /
		determinant;
	const y =
		((c * h - b * i) * normal.x +
			(a * i - c * g) * normal.y +
			(b * g - a * h) * normal.z) /
		determinant;
	const z =
		((b * f - c * e) * normal.x +
			(c * d - a * f) * normal.y +
			(a * e - b * d) * normal.z) /
		determinant;
	const magnitude = Math.hypot(x, y, z);
	if (!Number.isFinite(magnitude))
		throw new Error("Cannot bake a non-finite normal.");
	// Prepared DAT geometry can carry zero normals. Preserve that authored value rather than
	// inventing a face normal here; the current object program does not consume lighting normals.
	if (magnitude === 0) return Vec3.zero();
	return new Vec3(x / magnitude, y / magnitude, z / magnitude);
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

function expandBounds(bounds: AABB3, point: Vec3): void {
	bounds.min.x = Math.min(bounds.min.x, point.x);
	bounds.min.y = Math.min(bounds.min.y, point.y);
	bounds.min.z = Math.min(bounds.min.z, point.z);
	bounds.max.x = Math.max(bounds.max.x, point.x);
	bounds.max.y = Math.max(bounds.max.y, point.y);
	bounds.max.z = Math.max(bounds.max.z, point.z);
}

function assertBounds(bounds: AABB3, positions: readonly number[]): void {
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
		throw new Error("Baked building bounds are invalid.");
	}
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
			throw new Error("Baked building bounds do not contain a baked position.");
		}
	}
}

function assertFinite(vector: Vec3, label: string): void {
	if (
		!Number.isFinite(vector.x) ||
		!Number.isFinite(vector.y) ||
		!Number.isFinite(vector.z)
	) {
		throw new Error(`Building ${label} is not finite.`);
	}
}
