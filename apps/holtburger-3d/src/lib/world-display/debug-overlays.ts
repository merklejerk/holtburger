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
import type { RenderChunkPlacement } from "./render-chunks";

export interface WorldDebugOverlayOptions {
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
	selectedPortalId?: string | null;
	selectedEnvCellId?: number | null;
}

export type PortalOverlayTargetStatus =
	| "loaded-visible"
	| "known-unloaded"
	| "outside"
	| "unsupported"
	| "missing-polygon";

export interface CellDebugOverlay {
	envCellId: number;
	renderChunk: RenderChunkPlacement;
	renderKey: string;
	label: string;
	colorKey: string;
	isFocus: boolean;
	isSelected: boolean;
	chunkLocalPlacement: StructuredInteriorCell["chunkLocalPlacement"];
	localPlacement: StructuredInteriorCell["localPlacement"];
	landblockWorldOffset: StructuredInteriorCell["landblockWorldOffset"];
	bounds: { min: Vec3Dto; max: Vec3Dto } | null;
}

export interface PortalDebugOverlay {
	portalId: string;
	sourceEnvCellId: number;
	renderChunk: RenderChunkPlacement;
	targetEnvCellId: number | null;
	targetStatus: PortalOverlayTargetStatus;
	polygonId: number;
	otherPortalId: number;
	flags: number;
	isSelected: boolean;
	chunkLocalPlacement: StructuredInteriorCell["chunkLocalPlacement"];
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
		? structuredInteriorScene.cells.map((cell) =>
				createCellOverlay(cell, options.selectedEnvCellId ?? null),
			)
		: [];
	const portals = options.showPortalPolygons
		? structuredInteriorScene.cells.flatMap((cell) =>
				createPortalOverlays(
					cell,
					activeEnvCellIds,
					options.selectedPortalId ?? null,
				),
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

function createCellOverlay(
	cell: StructuredInteriorCell,
	selectedEnvCellId: number | null,
): CellDebugOverlay {
	const isSelected = cell.envCellId === selectedEnvCellId;
	return {
		envCellId: cell.envCellId,
		renderChunk: cell.renderChunk,
		renderKey: cell.renderKey,
		label: formatEnvCellSuffix(cell.envCellId),
		colorKey: isSelected
			? `${cell.debugColorKey}:selected`
			: cell.isFocus
				? `${cell.debugColorKey}:focus`
				: cell.debugColorKey,
		isFocus: cell.isFocus,
		isSelected,
		chunkLocalPlacement: cell.chunkLocalPlacement,
		localPlacement: cell.localPlacement,
		landblockWorldOffset: cell.landblockWorldOffset,
		bounds: cell.renderGeometry.bounds,
	};
}

function createPortalOverlays(
	cell: StructuredInteriorCell,
	activeEnvCellIds: ReadonlySet<number>,
	selectedPortalId: string | null,
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
			renderChunk: cell.renderChunk,
			targetEnvCellId,
			targetStatus,
			polygonId: portal.polygonId,
			otherPortalId: portal.otherPortalId,
			flags: portal.flags,
			isSelected: portal.portalId === selectedPortalId,
			chunkLocalPlacement: cell.chunkLocalPlacement,
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
	if (isOutsidePortal(portal)) {
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
): PortalOverlayTargetStatus {
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

function isOutsidePortal(portal: PreparedIndoorCellPortal): boolean {
	// Retail CCellPortal::UnPack maps flag 0x4 to other_cell_id = -1, then
	// transit resolves the crossing through outside landcell membership.
	return (portal.flags & 0x4) !== 0;
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
