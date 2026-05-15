import type { Vec3Dto } from "../host/contracts";
import type {
	PreparedIndoorCellPortal,
	PreparedPolygonSetPolygon,
	PreparedPolygonSetVertexArray,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";

export interface WorldDebugOverlayOptions {
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
}

export type PortalOverlayTargetStatus =
	| "loaded-visible"
	| "known-unloaded"
	| "unsupported"
	| "missing-polygon";

export interface CellDebugOverlay {
	envCellId: number;
	renderKey: string;
	label: string;
	colorKey: string;
	isFocus: boolean;
	localPlacement: StructuredInteriorCell["localPlacement"];
	landblockWorldOffset: StructuredInteriorCell["landblockWorldOffset"];
	bounds: { min: Vec3Dto; max: Vec3Dto } | null;
}

export interface PortalDebugOverlay {
	portalId: string;
	sourceEnvCellId: number;
	targetEnvCellId: number | null;
	targetStatus: PortalOverlayTargetStatus;
	polygonId: number;
	otherPortalId: number;
	flags: number;
	localPlacement: StructuredInteriorCell["localPlacement"];
	landblockWorldOffset: StructuredInteriorCell["landblockWorldOffset"];
	points: Vec3Dto[];
	colorKey: string;
}

export interface WorldDebugOverlayModel {
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
	cells: CellDebugOverlay[];
	portals: PortalDebugOverlay[];
	diagnostics: {
		cellCount: number;
		portalCount: number;
		missingPortalPolygonCount: number;
		knownTargetCount: number;
		loadedTargetCount: number;
	};
}

export function deriveWorldDebugOverlayModel(
	structuredInteriorScene: StructuredInteriorSceneModel,
	options: WorldDebugOverlayOptions,
): WorldDebugOverlayModel {
	const activeEnvCellIds = new Set(structuredInteriorScene.activeEnvCellIds);
	const cells = options.showCellIndicators
		? structuredInteriorScene.cells.map(createCellOverlay)
		: [];
	const portals = options.showPortalPolygons
		? structuredInteriorScene.cells.flatMap((cell) =>
				createPortalOverlays(cell, activeEnvCellIds),
			)
		: [];
	const knownTargetCount = portals.filter(
		(portal) => portal.targetEnvCellId !== null,
	).length;
	const loadedTargetCount = portals.filter(
		(portal) => portal.targetStatus === "loaded-visible",
	).length;

	return {
		...options,
		cells,
		portals,
		diagnostics: {
			cellCount: cells.length,
			portalCount: portals.length,
			missingPortalPolygonCount: portals.filter(
				(portal) => portal.targetStatus === "missing-polygon",
			).length,
			knownTargetCount,
			loadedTargetCount,
		},
	};
}

function createCellOverlay(cell: StructuredInteriorCell): CellDebugOverlay {
	return {
		envCellId: cell.envCellId,
		renderKey: cell.renderKey,
		label: formatEnvCellSuffix(cell.envCellId),
		colorKey: cell.isFocus ? `${cell.debugColorKey}:focus` : cell.debugColorKey,
		isFocus: cell.isFocus,
		localPlacement: cell.localPlacement,
		landblockWorldOffset: cell.landblockWorldOffset,
		bounds: cell.renderGeometry.bounds,
	};
}

function createPortalOverlays(
	cell: StructuredInteriorCell,
	activeEnvCellIds: ReadonlySet<number>,
): PortalDebugOverlay[] {
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
			portalId: portal.portalId,
			sourceEnvCellId: cell.envCellId,
			targetEnvCellId,
			targetStatus,
			polygonId: portal.polygonId,
			otherPortalId: portal.otherPortalId,
			flags: portal.flags,
			localPlacement: cell.localPlacement,
			landblockWorldOffset: cell.landblockWorldOffset,
			points,
			colorKey: `${cell.debugColorKey}:portal:${portal.portalId}:${targetStatus}`,
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
	if (portal.otherCellId === 0) {
		return null;
	}

	return portal.targetEnvCellId;
}

function resolveTargetStatus(
	targetEnvCellId: number | null,
	activeEnvCellIds: ReadonlySet<number>,
	points: Vec3Dto[],
): PortalOverlayTargetStatus {
	if (points.length < 3) {
		return "missing-polygon";
	}
	if (targetEnvCellId === null) {
		return "unsupported";
	}
	if (activeEnvCellIds.has(targetEnvCellId)) {
		return "loaded-visible";
	}

	return "known-unloaded";
}

function toRenderSpace(point: Vec3Dto): Vec3Dto {
	return {
		x: point.x,
		y: point.z,
		z: -point.y,
	};
}

function formatEnvCellSuffix(envCellId: number): string {
	return formatHex32(envCellId).slice(4);
}
