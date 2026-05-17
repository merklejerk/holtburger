import type { Vec3Dto } from "../host/contracts";
import type {
	PreparedIndoorCellPortal,
	PreparedPolygonSetPolygon,
	PreparedPolygonSetVertexArray,
} from "../assets/types";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { RenderChunkPlacement } from "./render-chunks";

export type PortalApertureTargetStatus =
	| "loaded-visible"
	| "known-unloaded"
	| "outside"
	| "unsupported"
	| "missing-polygon";

export interface PortalAperturePlane {
	normal: Vec3Dto;
	constant: number;
	source: "derived-from-render-points";
}

export interface PortalAperture {
	id: string;
	source: {
		kind: "env-cell";
		envCellId: number;
		portalId: string;
		sourceIndex: number;
		polygonId: number;
		flags: number;
		otherPortalId: number;
	};
	renderChunk: RenderChunkPlacement;
	chunkLocalPlacement: StructuredInteriorCell["chunkLocalPlacement"];
	points: Vec3Dto[];
	plane: PortalAperturePlane | null;
	targetEnvCellId: number | null;
	targetStatus: PortalApertureTargetStatus;
	outsideTransition: boolean;
}

export function derivePortalAperturesFromStructuredInteriorScene(
	structuredInteriorScene: StructuredInteriorSceneModel,
): PortalAperture[] {
	const activeEnvCellIds = new Set(structuredInteriorScene.activeEnvCellIds);
	return structuredInteriorScene.cells.flatMap((cell) =>
		createCellPortalApertures(cell, activeEnvCellIds),
	);
}

export function isOutsideTransitionPortal(
	portal: PreparedIndoorCellPortal,
): boolean {
	// Retail CCellPortal::UnPack maps flag 0x4 to other_cell_id = -1, then
	// transit resolves the crossing through outside landcell membership.
	return (portal.flags & 0x4) !== 0;
}

function createCellPortalApertures(
	cell: StructuredInteriorCell,
	activeEnvCellIds: ReadonlySet<number>,
): PortalAperture[] {
	const cellStructure = cell.cellStructure;
	if (!cellStructure) {
		return [];
	}

	const polygonsById = new Map(
		cellStructure.drawingPolygons.map((polygon) => [polygon.id, polygon]),
	);

	return cell.portals.map((portal) => {
		const polygon = polygonsById.get(portal.polygonId);
		const points = polygon
			? buildPortalPolygonPoints(cellStructure.vertexArray, polygon)
			: [];
		const targetEnvCellId = normalizePortalTargetEnvCellId(cell, portal);
		const targetStatus = resolveTargetStatus(
			targetEnvCellId,
			activeEnvCellIds,
			points,
		);

		return {
			id: portal.portalId,
			source: {
				kind: "env-cell",
				envCellId: cell.envCellId,
				portalId: portal.portalId,
				sourceIndex: portal.sourceIndex,
				polygonId: portal.polygonId,
				flags: portal.flags,
				otherPortalId: portal.otherPortalId,
			},
			renderChunk: cell.renderChunk,
			chunkLocalPlacement: cell.chunkLocalPlacement,
			points,
			plane: derivePortalAperturePlane(points),
			targetEnvCellId,
			targetStatus,
			outsideTransition: isOutsideTransitionPortal(portal),
		};
	});
}

function buildPortalPolygonPoints(
	vertexArray: PreparedPolygonSetVertexArray,
	polygon: PreparedPolygonSetPolygon,
): Vec3Dto[] {
	const verticesById = new Map(
		vertexArray.vertices.map((vertex) => [vertex.id, vertex]),
	);

	return polygon.vertexIds.flatMap((vertexId) => {
		const vertex = verticesById.get(vertexId);
		return vertex ? [toRenderSpace(vertex.origin)] : [];
	});
}

function normalizePortalTargetEnvCellId(
	cell: StructuredInteriorCell,
	portal: PreparedIndoorCellPortal,
): number | null {
	if (isOutsideTransitionPortal(portal)) {
		return (cell.envCellId & 0xffff_0000) | 0xffff;
	}
	if (portal.otherCellId === 0) {
		return null;
	}

	return portal.targetEnvCellId;
}

function resolveTargetStatus(
	targetEnvCellId: number | null,
	activeEnvCellIds: ReadonlySet<number>,
	points: Vec3Dto[],
): PortalApertureTargetStatus {
	if (points.length < 3) {
		return "missing-polygon";
	}
	if (targetEnvCellId !== null && (targetEnvCellId & 0xffff) === 0xffff) {
		return "outside";
	}
	if (targetEnvCellId === null) {
		return "unsupported";
	}
	if (activeEnvCellIds.has(targetEnvCellId)) {
		return "loaded-visible";
	}

	return "known-unloaded";
}

function derivePortalAperturePlane(points: Vec3Dto[]): PortalAperturePlane | null {
	const first = points[0];
	const second = points[1];
	const third = points[2];
	if (!first || !second || !third) {
		return null;
	}

	const edgeA = subtract(second, first);
	const edgeB = subtract(third, first);
	const normal = normalize(cross(edgeA, edgeB));
	if (!normal) {
		return null;
	}

	return {
		normal,
		constant: dot(normal, first),
		source: "derived-from-render-points",
	};
}

function toRenderSpace(point: Vec3Dto): Vec3Dto {
	return {
		x: point.x,
		y: point.z,
		z: -point.y,
	};
}

function subtract(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function cross(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function normalize(vector: Vec3Dto): Vec3Dto | null {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return null;
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

function dot(left: Vec3Dto, right: Vec3Dto): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}
