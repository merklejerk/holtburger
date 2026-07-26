import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import {
	orderResolvedObjectParts,
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
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import { TextureWrapMode } from "../textures/types";
import type { StaticObjectMaterialBinding } from "./artifacts";

/** One closed geometry job containing no runtime, device, or atlas callbacks. */
export interface StaticObjectGeometryJob {
	/** Typed source layer keeps geometry identities and later publication domains distinct. */
	readonly layer: LandblockLayerKind.Buildings | LandblockLayerKind.Objects;
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly source: ResolvedOutdoorStaticLayerSource;
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

/** Complete single-allocation geometry result returned by the closed worker. */
export interface StaticObjectGeometryResult {
	readonly geometry: {
		readonly key: StaticGeometryKey;
		readonly geometry: ObjectGeometryData;
	};
	readonly bounds: AABB3;
	readonly ranges: readonly BakedStaticObjectRange[];
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
	/** Interleaved XYZ values for the triangle's three positions. */
	readonly positions: readonly number[];
	/** Interleaved XYZ values for the triangle's three normals. */
	readonly normals: readonly number[];
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
export function bakeStaticObjectGeometry(
	job: StaticObjectGeometryJob,
): StaticObjectGeometryResult | null {
	assertJobLayer(job);
	const startedAt = performance.now();
	const groups = new Map<string, ContributionGroup>();
	const sourceRangeIds = new Set<string>();
	const sourceMaterialSlotIds = new Set<string>();
	for (const resident of job.source.staticResidents) {
		const residentScale = createScaleMat4(resident.scale);
		const partTransforms = createPartTransforms(resident);
		for (const part of resident.presentation.parts) {
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
	return {
		bounds,
		geometry: {
			geometry,
			key: `static-install-geometry:${job.resourceNamespace}/${job.layer}-layer` as StaticGeometryKey,
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
		transformPoint3(options.sourceToLandblock, sourcePosition, sourcePosition);
		transformNormal3(options.sourceToLandblock, sourceNormal, sourceNormal);
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
	resident: ResolvedOutdoorStaticLayerSource["staticResidents"][number],
): ReadonlyMap<number, Mat4> {
	const pose = resident.presentation.placementPoses.get(0);
	if (!pose)
		throw new Error(`Resident ${resident.id} has no default placement pose.`);
	const transforms = new Map<number, Mat4>();
	for (const part of orderResolvedObjectParts(resident.presentation.parts)) {
		const partIndex = part.partIndex;
		const localTransform = pose.partTransforms[partIndex];
		if (!localTransform) {
			throw new Error(
				`Resident ${resident.id} has no transform for part ${partIndex}.`,
			);
		}
		const parent =
			part.parentPartIndex === null
				? null
				: transforms.get(part.parentPartIndex);
		if (part.parentPartIndex !== null && !parent) {
			throw new Error(
				`Resident ${resident.id} has no transform for parent part ${part.parentPartIndex}.`,
			);
		}
		transforms.set(
			partIndex,
			parent ? multiplyMat4(parent, localTransform) : localTransform,
		);
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
		throw new Error("Baked static-object bounds are invalid.");
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
			throw new Error(
				"Baked static-object bounds do not contain a baked position.",
			);
		}
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
function assertJobLayer(job: StaticObjectGeometryJob): void {
	if (job.source.kind !== job.layer) {
		throw new Error(
			`Static-object geometry layer ${job.layer} does not match source layer ${job.source.kind}.`,
		);
	}
}
