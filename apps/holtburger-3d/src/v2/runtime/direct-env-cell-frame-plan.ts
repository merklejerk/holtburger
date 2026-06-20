import type {
	PortalApertureGeometryResourcePlan,
	PortalApertureMaskPass,
	PortalApertureVertex,
	PortalFrameWorkPlan,
	RendererEnvCellResourceMembership,
} from "../renderer/types";
import type { StaticPortalInteriorRecord } from "../static/contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "../static/bake/ac-placement-transform";
import type {
	PortalTraversalPlan,
	PortalTraversalVisibleCell,
	StaticSceneCameraResidency,
} from "./static-scene-query";
import { createOutdoorLandblockRootTranslation } from "./static-placement";

export interface DirectEnvCellFramePlanInput {
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly rendererEnvCellResourceMembership: readonly RendererEnvCellResourceMembership[];
	readonly traversalPlan: PortalTraversalPlan;
}

export function createDirectEnvCellFramePlan(
	input: DirectEnvCellFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.currentCameraResidency.kind !== "env-cell") {
		return null;
	}
	if (input.traversalPlan.visibleCells.length === 0) {
		return null;
	}

	const membershipsByKey = new Map(
		input.rendererEnvCellResourceMembership.map((membership) => [
			createEnvCellKey(membership.landblockId, membership.envCellId),
			membership,
		]),
	);
	const aperturePlan = createPortalAperturePlan({
		portalInteriorRecords: input.portalInteriorRecords,
		renderAnchorLandblockId: input.renderAnchorLandblockId,
		traversalPlan: input.traversalPlan,
	});

	return {
		baseScene: {
			envCellId: input.currentCameraResidency.envCellId,
			kind: "env-cell-direct",
			landblockId: input.currentCameraResidency.landblockId,
		},
		directEnvCellDraws: input.traversalPlan.visibleCells.map((cell) =>
			createDirectEnvCellDrawRequest(cell, membershipsByKey),
		),
		kind: "direct-env-cell",
		mode: "portal-traversal",
		portalApertureGeometryResources: aperturePlan.resources,
		portalApertureMaskPasses: aperturePlan.maskPasses,
		transitionSceneCrossings: [],
	};
}

function createDirectEnvCellDrawRequest(
	cell: PortalTraversalVisibleCell,
	membershipsByKey: ReadonlyMap<string, RendererEnvCellResourceMembership>,
): Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
>["directEnvCellDraws"][number] {
	const membership =
		membershipsByKey.get(createEnvCellKey(cell.landblockId, cell.envCellId)) ??
		null;
	const structuredInteriorDrawUnitIds =
		membership?.structuredInteriorDrawUnitIds ?? [];
	const envCellStaticObjectDrawUnitIds =
		membership?.envCellStaticObjectDrawUnitIds ?? [];
	const hasDrawResources =
		structuredInteriorDrawUnitIds.length > 0 ||
		envCellStaticObjectDrawUnitIds.length > 0;
	return {
		envCellId: cell.envCellId,
		envCellStaticObjectDrawUnitIds,
		landblockId: cell.landblockId,
		portalStackId: cell.portalStackId,
		resourceState: hasDrawResources ? "ready" : "missing-resources",
		structuredInteriorDrawUnitIds,
		traversalDepth: cell.traversalDepth,
	};
}

function createEnvCellKey(landblockId: number, envCellId: number): string {
	return `${landblockId >>> 0}:${envCellId >>> 0}`;
}

function createPortalAperturePlan(options: {
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly traversalPlan: PortalTraversalPlan;
}): {
	readonly maskPasses: readonly PortalApertureMaskPass[];
	readonly resources: readonly PortalApertureGeometryResourcePlan[];
} {
	const resources: PortalApertureGeometryResourcePlan[] = [];
	const resourcesByKey = new Map<string, PortalApertureGeometryResourcePlan>();
	const envCellsByKey = createPortalEnvCellsByKey(
		options.portalInteriorRecords,
	);
	const visibleCellsByEnvCellId = new Map(
		options.traversalPlan.visibleCells.map((cell) => [cell.envCellId, cell]),
	);
	const maskableEnvCellIds = new Set<number>([
		options.traversalPlan.startEnvCellId,
	]);
	const maskPasses: PortalApertureMaskPass[] = [];

	for (const cell of options.traversalPlan.visibleCells) {
		if (cell.parentEdge === null) {
			continue;
		}
		const parentEdge = cell.parentEdge;
		const sourceCell = visibleCellsByEnvCellId.get(parentEdge.sourceEnvCellId);
		if (!sourceCell) {
			continue;
		}
		if (!maskableEnvCellIds.has(sourceCell.envCellId)) {
			continue;
		}
		const parentStencilRef =
			sourceCell.traversalDepth === 0 ? null : sourceCell.traversalDepth;
		const sourceEnvCell = envCellsByKey.get(
			createEnvCellKey(cell.landblockId, parentEdge.sourceEnvCellId),
		);
		const aperture = sourceEnvCell?.portalApertures.find(
			(candidate) => candidate.portalId === parentEdge.sourcePortalId,
		);
		if (!sourceEnvCell || !aperture) {
			continue;
		}
		const vertices = triangulateEnvCellPortalAperture(
			aperture.points,
			buildAcPlacementMatrix(sourceEnvCell.localPlacement, AC_UNIT_SCALE),
			createOutdoorLandblockRootTranslation(
				cell.landblockId,
				options.renderAnchorLandblockId,
			),
		);
		if (vertices.length === 0) {
			continue;
		}
		if (cell.traversalDepth > 254) {
			throw new Error("Direct env-cell portal plan exceeded 254 stencil refs.");
		}
		const resource = getOrCreatePortalApertureGeometryResource(
			vertices,
			resources,
			resourcesByKey,
		);
		maskableEnvCellIds.add(cell.envCellId);
		maskPasses.push({
			apertureResourceId: resource.resourceId,
			linkId: parentEdge.linkId,
			parentStencilRef: parentStencilRef ?? null,
			portalStackId: cell.portalStackId,
			source: {
				envCellId: parentEdge.sourceEnvCellId,
				kind: "env-cell-direct",
				landblockId: cell.landblockId,
			},
			stencilRef: cell.traversalDepth,
			target: {
				envCellId: cell.envCellId,
				kind: "env-cell-direct",
				landblockId: cell.landblockId,
			},
			traversalDepth: cell.traversalDepth,
		});
	}

	return { maskPasses, resources };
}

function createPortalEnvCellsByKey(
	records: readonly StaticPortalInteriorRecord[],
): ReadonlyMap<string, StaticPortalInteriorRecord["envCells"][number]> {
	const envCellsByKey = new Map<
		string,
		StaticPortalInteriorRecord["envCells"][number]
	>();
	for (const record of records) {
		for (const envCell of record.envCells) {
			envCellsByKey.set(
				createEnvCellKey(record.landblockId, envCell.envCellId),
				envCell,
			);
		}
	}
	return envCellsByKey;
}

function getOrCreatePortalApertureGeometryResource(
	vertices: readonly PortalApertureVertex[],
	resources: PortalApertureGeometryResourcePlan[],
	resourcesByKey: Map<string, PortalApertureGeometryResourcePlan>,
): PortalApertureGeometryResourcePlan {
	const key = createPortalApertureGeometryKey(vertices);
	const existingResource = resourcesByKey.get(key);
	if (existingResource) {
		return existingResource;
	}
	const resource: PortalApertureGeometryResourcePlan = {
		resourceId: `portal-aperture:${hashStringFNV1a(key)}`,
		vertices,
	};
	resourcesByKey.set(key, resource);
	resources.push(resource);
	return resource;
}

function triangulateEnvCellPortalAperture(
	points: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly PortalApertureVertex[] {
	if (points.length < 3) {
		return [];
	}
	const vertices: PortalApertureVertex[] = [];
	for (let index = 1; index < points.length - 1; index += 1) {
		vertices.push(
			transformEnvCellPortalPoint(points[0], matrix, translation),
			transformEnvCellPortalPoint(points[index], matrix, translation),
			transformEnvCellPortalPoint(points[index + 1], matrix, translation),
		);
	}
	return vertices;
}

function transformEnvCellPortalPoint(
	point: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"][number],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): PortalApertureVertex {
	return [
		matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12] +
			translation[0],
		matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13] +
			translation[1],
		matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14] +
			translation[2],
	];
}

function createPortalApertureGeometryKey(
	vertices: readonly PortalApertureVertex[],
): string {
	return vertices
		.map((vertex) => vertex.map((value) => value.toFixed(6)).join(","))
		.join(";");
}

function hashStringFNV1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
