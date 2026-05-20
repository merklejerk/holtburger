import type { Vec3Dto } from "../host/contracts";
import {
	derivePortalAperturesFromStructuredInteriorScene,
	type PortalAperture,
	type PortalApertureTargetStatus,
} from "./portal-apertures";
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

export type PortalOverlayTargetStatus = PortalApertureTargetStatus;

export interface CellDebugOverlay {
	envCellId: number;
	renderChunk: RenderChunkPlacement;
	renderKey: string;
	label: string;
	colorKey: string;
	isFocus: boolean;
	isSelected: boolean;
	chunkLocalPlacement: StructuredInteriorCell["chunkLocalPlacement"];
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

export function createEmptyWorldDebugOverlayModel(): WorldDebugOverlayModel {
	return {
		showPortalPolygons: false,
		showCellIndicators: false,
		highlightPortalTargets: false,
		cells: [],
		portals: [],
		diagnostics: {
			cellCount: 0,
			portalCount: 0,
			missingPortalPolygonCount: 0,
			knownTargetCount: 0,
			loadedTargetCount: 0,
		},
	};
}

export function deriveWorldDebugOverlayModel(
	structuredInteriorScene: StructuredInteriorSceneModel,
	options: WorldDebugOverlayOptions,
): WorldDebugOverlayModel {
	const cells = options.showCellIndicators
		? structuredInteriorScene.cells.map((cell) =>
				createCellOverlay(cell, options.selectedEnvCellId ?? null),
			)
		: [];
	const portals = options.showPortalPolygons
		? derivePortalAperturesFromStructuredInteriorScene(
				structuredInteriorScene,
			).map((aperture) =>
				createPortalOverlay(aperture, options.selectedPortalId ?? null),
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
		bounds: cell.renderGeometry.bounds,
	};
}

function createPortalOverlay(
	aperture: PortalAperture,
	selectedPortalId: string | null,
): PortalDebugOverlay {
	return {
		portalId: aperture.id,
		sourceEnvCellId: aperture.source.envCellId,
		renderChunk: aperture.renderChunk,
		targetEnvCellId: aperture.targetEnvCellId,
		targetStatus: aperture.targetStatus,
		polygonId: aperture.source.polygonId,
		otherPortalId: aperture.source.otherPortalId,
		flags: aperture.source.flags,
		isSelected: aperture.id === selectedPortalId,
		chunkLocalPlacement: aperture.chunkLocalPlacement,
		points: aperture.points,
		colorKey: `${aperture.source.envCellId.toString(16)}:portal:${aperture.id}:${aperture.targetStatus}`,
	};
}

function formatEnvCellSuffix(envCellId: number): string {
	return formatHex32(envCellId).slice(4);
}
