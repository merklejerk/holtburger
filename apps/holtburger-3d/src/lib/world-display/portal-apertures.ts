import type { Vec3Dto } from "../host/contracts";
import type {
	PreparedIndoorCellPortal,
	PreparedPortalAperture as PreparedPortalApertureGeometry,
	PreparedPolygonSetBspNode,
	PreparedPolygonSetPortalPoly,
	PreparedPolygonSetPolygon,
	PreparedPolygonSetPlane,
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
	source: "drawing-bsp-portal" | "derived-from-render-points";
}

export type PortalApertureVisibleSide = "positive" | "negative";

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
	visibleSide: PortalApertureVisibleSide;
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
	if (cell.portalApertures.length > 0) {
		return createPreparedCellPortalApertures(cell, activeEnvCellIds);
	}

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
			plane:
				derivePortalApertureSourcePlane(cellStructure.drawingBsp, portal) ??
				derivePortalAperturePlaneFromPoints(points),
			visibleSide: decodePortalVisibleSide(portal.flags),
			targetEnvCellId,
			targetStatus,
			outsideTransition: isOutsideTransitionPortal(portal),
		};
	});
}

function createPreparedCellPortalApertures(
	cell: StructuredInteriorCell,
	activeEnvCellIds: ReadonlySet<number>,
): PortalAperture[] {
	const preparedAperturesByPortalId = new Map(
		cell.portalApertures.map((aperture) => [aperture.portalId, aperture]),
	);

	return cell.portals.map((portal) => {
		const preparedAperture = preparedAperturesByPortalId.get(portal.portalId);
		const points = preparedAperture?.points ?? [];
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
			plane: normalizePreparedPortalAperturePlane(preparedAperture),
			visibleSide: decodePortalVisibleSide(portal.flags),
			targetEnvCellId,
			targetStatus,
			outsideTransition: isOutsideTransitionPortal(portal),
		};
	});
}

function normalizePreparedPortalAperturePlane(
	aperture: PreparedPortalApertureGeometry | undefined,
): PortalAperturePlane | null {
	return (
		aperture?.plane ??
		derivePortalAperturePlaneFromPoints(aperture?.points ?? [])
	);
}

export function decodePortalVisibleSide(
	flags: number,
): PortalApertureVisibleSide {
	// Retail decodes portal_side as ((~flags >> 1) & 1). A true portal_side
	// accepts the negative side of the portal plane; raw flag 0x2 therefore
	// selects the positive visible side.
	return (flags & 0x2) === 0 ? "negative" : "positive";
}

export function oppositePortalVisibleSide(
	side: PortalApertureVisibleSide,
): PortalApertureVisibleSide {
	return side === "positive" ? "negative" : "positive";
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

function derivePortalApertureSourcePlane(
	drawingBsp: PreparedPolygonSetBspNode | null,
	portal: PreparedIndoorCellPortal,
): PortalAperturePlane | null {
	const sourcePlane = findPortalPlaneByPortalReference(drawingBsp, portal);
	if (!sourcePlane) {
		return null;
	}

	return convertAcPlaneToRenderPlane(sourcePlane);
}

function findPortalPlaneByPortalReference(
	node: PreparedPolygonSetBspNode | null,
	portal: PreparedIndoorCellPortal,
): PreparedPolygonSetPlane | null {
	if (!node) {
		return null;
	}

	if (node.kind === "port") {
		const plane = readBspPlane(node.plane);
		const portalPolys = readBspPortalPolys(node.portalPolys);
		const positiveNode = readBspChild(node.pos);
		const negativeNode = readBspChild(node.neg);
		const hasPortalPoly = portalPolys.some(
			(portalPoly) =>
				portalPoly.portalIndex === portal.sourceIndex ||
				portalPoly.polyId === portal.polygonId,
		);
		if (hasPortalPoly && plane) {
			return plane;
		}

		return (
			findPortalPlaneByPortalReference(positiveNode, portal) ??
			findPortalPlaneByPortalReference(negativeNode, portal)
		);
	}

	if (node.kind === "internal") {
		const positiveNode = readBspChild(node.pos);
		const negativeNode = readBspChild(node.neg);
		return (
			findPortalPlaneByPortalReference(positiveNode, portal) ??
			findPortalPlaneByPortalReference(negativeNode, portal)
		);
	}

	return null;
}

function readBspChild(value: unknown): PreparedPolygonSetBspNode | null {
	if (!isRecord(value) || typeof value.kind !== "string") {
		return null;
	}

	return value as PreparedPolygonSetBspNode;
}

function readBspPlane(value: unknown): PreparedPolygonSetPlane | null {
	if (
		!isRecord(value) ||
		!isVec3Dto(value.normal) ||
		typeof value.d !== "number"
	) {
		return null;
	}

	return {
		normal: value.normal,
		d: value.d,
	};
}

function readBspPortalPolys(value: unknown): PreparedPolygonSetPortalPoly[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(isPreparedPolygonSetPortalPoly);
}

function isPreparedPolygonSetPortalPoly(
	value: unknown,
): value is PreparedPolygonSetPortalPoly {
	return (
		isRecord(value) &&
		typeof value.portalIndex === "number" &&
		typeof value.polyId === "number"
	);
}

function isVec3Dto(value: unknown): value is Vec3Dto {
	return (
		isRecord(value) &&
		typeof value.x === "number" &&
		typeof value.y === "number" &&
		typeof value.z === "number"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function convertAcPlaneToRenderPlane(
	plane: PreparedPolygonSetPlane,
): PortalAperturePlane {
	const normal = toRenderSpace(plane.normal);
	return {
		normal,
		constant: -plane.d,
		source: "drawing-bsp-portal",
	};
}

function derivePortalAperturePlaneFromPoints(
	points: Vec3Dto[],
): PortalAperturePlane | null {
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
