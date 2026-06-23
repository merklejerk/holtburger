import type { FrameState } from "../renderer/types";
import type {
	StaticPortalApertureResource,
	StaticPortalProjectionRecord,
} from "../static/contracts";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";
import { createOutdoorLandblockRootTranslation } from "./static-placement";
import type { StaticSceneCameraResidency } from "./static-scene-query";

export const EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY: RuntimePortalOverlapResidency =
	{
		baseOverlapEnvCellIds: [],
		boundaries: [],
		kind: "none",
		missingResourceEnvCellIds: [],
		requiresExteriorSeed: false,
		signature: "none",
	};

export interface RuntimePortalOverlapResidency {
	readonly kind: "none" | "portal-overlap";
	readonly signature: string;
	readonly boundaries: readonly RuntimePortalOverlapBoundary[];
	readonly baseOverlapEnvCellIds: readonly number[];
	readonly missingResourceEnvCellIds: readonly number[];
	readonly requiresExteriorSeed: boolean;
}

export interface RuntimePortalOverlapBoundary {
	readonly apertureRangeId: string;
	readonly boundaryId: string;
	readonly signedCameraPlaneDistance: number;
	readonly sourceEnvCellId: number | null;
	readonly sourceKind: "env-cell-portal" | "building-transition";
	readonly targetEnvCellId: number;
}

export interface PortalOverlapResidencyInput {
	readonly aperturePadding: number;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly frameState: FrameState;
	readonly planeEpsilon: number;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly projection: StaticPortalProjectionRecord;
	readonly renderAnchorLandblockId: number | null;
	readonly residency: StaticSceneCameraResidency;
}

interface PortalOverlapCandidate {
	readonly apertureRangeId: string;
	readonly boundaryId: string;
	readonly sourceEnvCellId: number | null;
	readonly sourceKind: "env-cell-portal" | "building-transition";
	readonly targetEnvCellId: number;
}

interface ApertureRangeLookup {
	readonly range: StaticPortalApertureResource["ranges"][number];
	readonly resource: StaticPortalApertureResource;
}

interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export function deriveRuntimePortalOverlapResidency(
	input: PortalOverlapResidencyInput,
): RuntimePortalOverlapResidency {
	if (
		input.residency.kind !== "env-cell" &&
		input.residency.kind !== "outdoor-landblock"
	) {
		return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
	}
	const apertureRangeById = createApertureRangeLookup(
		input.portalApertureResources,
	);
	const boundaries = createPortalOverlapCandidates(input)
		.flatMap((candidate) => {
			const apertureRange = apertureRangeById.get(candidate.apertureRangeId);
			if (!apertureRange) {
				return [];
			}
			const signedCameraPlaneDistance = classifyApertureRange({
				aperturePadding: input.aperturePadding,
				frameState: input.frameState,
				planeEpsilon: input.planeEpsilon,
				range: apertureRange.range,
				renderAnchorLandblockId: input.renderAnchorLandblockId,
				resource: apertureRange.resource,
			});
			return signedCameraPlaneDistance === null
				? []
				: [
						{
							apertureRangeId: candidate.apertureRangeId,
							boundaryId: candidate.boundaryId,
							signedCameraPlaneDistance,
							sourceEnvCellId: candidate.sourceEnvCellId,
							sourceKind: candidate.sourceKind,
							targetEnvCellId: candidate.targetEnvCellId,
						} satisfies RuntimePortalOverlapBoundary,
					];
		})
		.sort(comparePortalOverlapBoundaries);
	if (boundaries.length === 0) {
		return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
	}
	const baseOverlapEnvCellIds = [
		...new Set(boundaries.map((boundary) => boundary.targetEnvCellId)),
	].sort(compareNumbers);
	const missingResourceEnvCellIds = findMissingResourceEnvCellIds({
		envCellIds: baseOverlapEnvCellIds,
		envCellResourceMembership: input.envCellResourceMembership,
		landblockId: input.projection.landblockId,
	});
	const requiresExteriorSeed =
		input.residency.kind === "env-cell" &&
		boundaries.some((boundary) => boundary.sourceKind === "building-transition");
	return {
		baseOverlapEnvCellIds,
		boundaries,
		kind: "portal-overlap",
		missingResourceEnvCellIds,
		requiresExteriorSeed,
		signature: createPortalOverlapSignature({
			baseOverlapEnvCellIds,
			boundaries,
			requiresExteriorSeed,
		}),
	};
}

function findMissingResourceEnvCellIds(options: {
	readonly envCellIds: readonly number[];
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly landblockId: number;
}): readonly number[] {
	const resourceEnvCellIds = new Set(
		options.envCellResourceMembership
			.filter(
				(membership) =>
					membership.landblockId === options.landblockId &&
					(membership.structuredInteriorDrawUnitIds.length > 0 ||
						membership.envCellStaticObjectDrawUnitIds.length > 0),
			)
			.map((membership) => membership.envCellId),
	);
	return options.envCellIds
		.filter((envCellId) => !resourceEnvCellIds.has(envCellId))
		.sort(compareNumbers);
}

function createApertureRangeLookup(
	resources: readonly StaticPortalApertureResource[],
): ReadonlyMap<string, ApertureRangeLookup> {
	const lookup = new Map<string, ApertureRangeLookup>();
	for (const resource of resources) {
		if (resource.coordinateSpace !== "landblock-render-local") {
			continue;
		}
		for (const range of resource.ranges) {
			lookup.set(range.rangeId, { range, resource });
		}
	}
	return lookup;
}

function createPortalOverlapCandidates(
	input: PortalOverlapResidencyInput,
): readonly PortalOverlapCandidate[] {
	if (input.residency.kind === "env-cell") {
		const edgeCandidates = input.projection.edges
			.filter(
				(edge) =>
					edge.sourceKind === "env-cell-portal" &&
					edge.sourceEnvCellId === input.residency.envCellId,
			)
			.map(
				(edge): PortalOverlapCandidate => ({
					apertureRangeId: edge.apertureRangeId,
					boundaryId: edge.edgeId,
					sourceEnvCellId: edge.sourceEnvCellId,
					sourceKind: "env-cell-portal",
					targetEnvCellId: edge.targetEnvCellId,
				}),
			);
		const outdoorCrossingCandidates = input.projection.outdoorSceneCrossings
			.filter((crossing) => crossing.targetEnvCellId === input.residency.envCellId)
			.map(
				(crossing): PortalOverlapCandidate => ({
					apertureRangeId: crossing.apertureRangeId,
					boundaryId: crossing.crossingId,
					sourceEnvCellId: null,
					sourceKind: "building-transition",
					targetEnvCellId: crossing.targetEnvCellId,
				}),
			);
		return [...edgeCandidates, ...outdoorCrossingCandidates];
	}
	if (input.residency.kind === "outdoor-landblock") {
		return input.projection.edges
			.filter(
				(edge) =>
					edge.sourceKind === "building-transition" &&
					edge.sourceEnvCellId === null,
			)
			.map(
				(edge): PortalOverlapCandidate => ({
					apertureRangeId: edge.apertureRangeId,
					boundaryId: edge.edgeId,
					sourceEnvCellId: null,
					sourceKind: "building-transition",
					targetEnvCellId: edge.targetEnvCellId,
				}),
			);
	}
	return [];
}

function classifyApertureRange(options: {
	readonly aperturePadding: number;
	readonly frameState: FrameState;
	readonly planeEpsilon: number;
	readonly range: StaticPortalApertureResource["ranges"][number];
	readonly renderAnchorLandblockId: number | null;
	readonly resource: StaticPortalApertureResource;
}): number | null {
	const vertices = readApertureRangeVertices(options.resource, options.range);
	if (vertices.length < 3) {
		return null;
	}
	const plane = derivePlane(vertices);
	if (!plane) {
		return null;
	}
	const translation = createOutdoorLandblockRootTranslation(
		options.resource.landblockId,
		options.renderAnchorLandblockId,
	);
	const cameraPoint = {
		x: options.frameState.camera.position[0] - translation[0],
		y: options.frameState.camera.position[1] - translation[1],
		z: options.frameState.camera.position[2] - translation[2],
	};
	const signedDistance = dot(plane.normal, cameraPoint) + plane.offset;
	if (Math.abs(signedDistance) > options.planeEpsilon) {
		return null;
	}
	const projectedPoint = {
		x: cameraPoint.x - plane.normal.x * signedDistance,
		y: cameraPoint.y - plane.normal.y * signedDistance,
		z: cameraPoint.z - plane.normal.z * signedDistance,
	};
	if (
		!isPointInsideProjectedApertureBounds(
			projectedPoint,
			vertices,
			plane.normal,
			options.aperturePadding,
		)
	) {
		return null;
	}
	return signedDistance;
}

function readApertureRangeVertices(
	resource: StaticPortalApertureResource,
	range: StaticPortalApertureResource["ranges"][number],
): readonly Vec3[] {
	const byIndex = new Map<number, Vec3>();
	for (let offset = 0; offset < range.indexCount; offset += 1) {
		const index = resource.indices[range.firstIndex + offset];
		if (index === undefined || byIndex.has(index)) {
			continue;
		}
		const vertex = resource.vertices[index];
		if (!vertex) {
			continue;
		}
		byIndex.set(index, vertex);
	}
	return [...byIndex.values()];
}

function derivePlane(vertices: readonly Vec3[]): {
	readonly normal: Vec3;
	readonly offset: number;
} | null {
	const origin = vertices[0];
	if (!origin) {
		return null;
	}
	for (let secondIndex = 1; secondIndex < vertices.length - 1; secondIndex += 1) {
		const second = vertices[secondIndex];
		if (!second) {
			continue;
		}
		for (
			let thirdIndex = secondIndex + 1;
			thirdIndex < vertices.length;
			thirdIndex += 1
		) {
			const third = vertices[thirdIndex];
			if (!third) {
				continue;
			}
			const normal = normalize(
				cross(subtract(second, origin), subtract(third, origin)),
			);
			if (!normal) {
				continue;
			}
			return {
				normal,
				offset: -dot(normal, origin),
			};
		}
	}
	return null;
}

function isPointInsideProjectedApertureBounds(
	point: Vec3,
	vertices: readonly Vec3[],
	normal: Vec3,
	padding: number,
): boolean {
	const axis = chooseProjectionAxis(normal);
	let minU = Number.POSITIVE_INFINITY;
	let maxU = Number.NEGATIVE_INFINITY;
	let minV = Number.POSITIVE_INFINITY;
	let maxV = Number.NEGATIVE_INFINITY;
	for (const vertex of vertices) {
		const [u, v] = projectPoint(vertex, axis);
		minU = Math.min(minU, u);
		maxU = Math.max(maxU, u);
		minV = Math.min(minV, v);
		maxV = Math.max(maxV, v);
	}
	const [pointU, pointV] = projectPoint(point, axis);
	return (
		pointU >= minU - padding &&
		pointU <= maxU + padding &&
		pointV >= minV - padding &&
		pointV <= maxV + padding
	);
}

function chooseProjectionAxis(normal: Vec3): "x" | "y" | "z" {
	const absX = Math.abs(normal.x);
	const absY = Math.abs(normal.y);
	const absZ = Math.abs(normal.z);
	if (absX >= absY && absX >= absZ) {
		return "x";
	}
	return absY >= absZ ? "y" : "z";
}

function projectPoint(point: Vec3, droppedAxis: "x" | "y" | "z"): readonly [
	number,
	number,
] {
	switch (droppedAxis) {
		case "x":
			return [point.y, point.z];
		case "y":
			return [point.x, point.z];
		case "z":
			return [point.x, point.y];
	}
}

function createPortalOverlapSignature(options: {
	readonly baseOverlapEnvCellIds: readonly number[];
	readonly boundaries: readonly RuntimePortalOverlapBoundary[];
	readonly requiresExteriorSeed: boolean;
}): string {
	return [
		options.requiresExteriorSeed ? "exterior-seed" : "no-exterior-seed",
		`cells=${options.baseOverlapEnvCellIds.map(formatHex32).join(",")}`,
		`boundaries=${options.boundaries
			.map(
				(boundary) =>
					`${boundary.sourceKind}:${boundary.boundaryId}:${formatHex32(
						boundary.targetEnvCellId,
					)}`,
			)
			.join(",")}`,
	].join("|");
}

function comparePortalOverlapBoundaries(
	left: RuntimePortalOverlapBoundary,
	right: RuntimePortalOverlapBoundary,
): number {
	return (
		left.sourceKind.localeCompare(right.sourceKind) ||
		left.boundaryId.localeCompare(right.boundaryId) ||
		left.targetEnvCellId - right.targetEnvCellId
	);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function subtract(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function cross(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalize(vector: Vec3): Vec3 | null {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length <= Number.EPSILON) {
		return null;
	}
	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
