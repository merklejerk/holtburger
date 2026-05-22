import {
	browserDestinationToInteriorCellId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedInteriorCellStructure,
	PreparedAssetRecord,
	PreparedIndoorCellPortal,
	PreparedLandblockInteriorCell,
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPortalAperture,
} from "../assets/types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto } from "../host/contracts";
import { formatHex32 } from "../landblocks";
import {
	deriveStructuredCellRenderChunk,
	type RenderChunkPlacement,
} from "./render-chunks";
import { WORLD_RENDER_DOMAIN, formatRenderDomainKey } from "./render-domains";

export interface LinkedOutdoorInteriorSelection {
	envCellIds: number[];
}

export interface StructuredInteriorCell {
	renderKey: string;
	envCellId: number;
	renderChunk: RenderChunkPlacement;
	environmentId: number;
	cellStructureId: number;
	isFocus: boolean;
	chunkLocalPlacement: PlacementTransformDto;
	surfaceIds: number[];
	portalCount: number;
	portals: PreparedIndoorCellPortal[];
	portalApertures: PreparedPortalAperture[];
	staticObjectCount: number;
	cellStructure: PreparedInteriorCellStructure | null;
	cellBsp: PreparedPolygonSetBspNode | null;
	renderGeometry: PreparedPolygonSetRenderGeometry;
	debugColorKey: string;
}

export interface StructuredInteriorSceneModel {
	focusEnvCellId: number | null;
	activeEnvCellIds: number[];
	cells: StructuredInteriorCell[];
	missingEnvCellAssetIds: string[];
	missingInteriorGeometryAssetIds: string[];
	missingCellStructureKeys: string[];
	statusText: string;
	cacheText: string;
}

export function createEmptyStructuredInteriorSceneModel(): StructuredInteriorSceneModel {
	return emptyStructuredInteriorSceneModel(
		null,
		[],
		"Structured interior rendering is waiting for scene input.",
		"Structured interior cache is idle.",
	);
}

export function deriveStructuredInteriorSceneModel(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	linkedOutdoorInteriors: LinkedOutdoorInteriorSelection | null = null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
): StructuredInteriorSceneModel {
	const browserFocusEnvCellId =
		browserDestinationToInteriorCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveBrowserFocusedStructuredInteriorSceneModel(
			browserFocusEnvCellId,
			assetState,
			structuredInteriorCoverage,
		);
	}

	if (linkedOutdoorInteriors && linkedOutdoorInteriors.envCellIds.length > 0) {
		return deriveStructuredInteriorSceneForEnvCells(
			null,
			structuredInteriorCoverage?.envCellIds ??
				deriveStructuredInteriorCoverage(
					{
						kind: "landblock-closure",
						seedEnvCellIds: linkedOutdoorInteriors.envCellIds,
					},
					assetState.preparedByAssetId,
				).envCellIds,
			assetState,
		);
	}

	return emptyStructuredInteriorSceneModel(
		null,
		[],
		"Structured interior scene is dormant until the browser destination or outdoor links select env cells.",
		"Structured interior cache is idle.",
	);
}

function deriveBrowserFocusedStructuredInteriorSceneModel(
	focusEnvCellId: number,
	assetState: AssetChannelState,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): StructuredInteriorSceneModel {
	const activeEnvCellIds =
		structuredInteriorCoverage?.envCellIds ??
		deriveBrowserFocusedEnvCellIdsFromPacks(focusEnvCellId, assetState) ??
		deriveStructuredInteriorCoverage(
			deriveBrowserFocusedStructuredInteriorMembershipPolicy(focusEnvCellId),
			assetState.preparedByAssetId,
		).envCellIds;

	return deriveStructuredInteriorSceneForEnvCells(
		focusEnvCellId,
		activeEnvCellIds,
		assetState,
	);
}

function deriveStructuredInteriorSceneForEnvCells(
	focusEnvCellId: number | null,
	activeEnvCellIds: number[],
	assetState: AssetChannelState,
): StructuredInteriorSceneModel {
	const cells: StructuredInteriorCell[] = [];

	for (const envCellId of activeEnvCellIds) {
		const packCell = findPreparedPackInteriorCell(
			assetState.preparedByAssetId,
			envCellId,
		);
		if (packCell) {
			const renderChunk = deriveStructuredCellRenderChunk(envCellId);
			cells.push({
				renderKey: formatRenderDomainKey(
					WORLD_RENDER_DOMAIN.interiorCellShell,
					`landblock-pack/${formatHex32(envCellId & 0xffff0000)}/interior-cell/${formatHex32(envCellId)}`,
				),
				envCellId,
				renderChunk,
				environmentId: packCell.environmentId,
				cellStructureId: packCell.cellStructureId,
				isFocus: focusEnvCellId !== null && envCellId === focusEnvCellId,
				chunkLocalPlacement: packCell.localPlacement,
				surfaceIds: packCell.surfaceIds,
				portalCount: packCell.portals.length,
				portals: packCell.portals.map((portal) => ({
					portalId: portal.portalId,
					sourceIndex: portal.sourceIndex,
					flags: portal.flags,
					polygonId: portal.polygonId,
					otherCellId: portal.otherCellId,
					otherPortalId: portal.otherPortalId,
					targetEnvCellId:
						portal.targetEnvCellId ??
						(envCellId & 0xffff0000) | portal.otherCellId,
				})),
				portalApertures: packCell.portalApertures,
				staticObjectCount: packCell.staticObjectCount,
				cellStructure: null,
				cellBsp: packCell.cellBsp,
				renderGeometry: packCell.renderGeometry,
				debugColorKey: `landblock-pack:${envCellId}:${packCell.environmentId}:${formatHex32(packCell.cellStructureId)}`,
			});
			continue;
		}
	}

	return {
		focusEnvCellId,
		activeEnvCellIds,
		cells: cells.sort(compareStructuredInteriorCells),
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: describeStructuredInteriorStatus(cells, focusEnvCellId),
		cacheText: describePreparedIndoorCache(assetState),
	};
}

function deriveBrowserFocusedEnvCellIdsFromPacks(
	focusEnvCellId: number,
	assetState: AssetChannelState,
): number[] | null {
	const focusLandblockPrefix = focusEnvCellId & 0xffff0000;
	const envCellIds = Object.values(assetState.preparedByAssetId)
		.flatMap((asset) =>
			asset.payload.kind === "landblock-pack"
				? asset.payload.prepared.interiorCells
				: [],
		)
		.filter((cell) => (cell.envCellId & 0xffff0000) === focusLandblockPrefix)
		.map((cell) => cell.envCellId);

	return envCellIds.length > 0
		? [...new Set(envCellIds)].sort((left, right) => left - right)
		: null;
}

function findPreparedPackInteriorCell(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	envCellId: number,
): PreparedLandblockInteriorCell | null {
	for (const asset of Object.values(preparedByAssetId)) {
		if (asset.payload.kind !== "landblock-pack") {
			continue;
		}

		const cell = asset.payload.prepared.interiorCells.find(
			(candidate) => candidate.envCellId === envCellId,
		);
		if (cell) {
			return cell;
		}
	}

	return null;
}

function compareStructuredInteriorCells(
	left: StructuredInteriorCell,
	right: StructuredInteriorCell,
): number {
	if (left.isFocus !== right.isFocus) {
		return left.isFocus ? -1 : 1;
	}

	return left.envCellId - right.envCellId;
}

function describeStructuredInteriorStatus(
	cells: StructuredInteriorCell[],
	focusEnvCellId: number | null,
): string {
	if (focusEnvCellId === null) {
		if (cells.length === 0) {
			return "Three.js is waiting for outdoor-linked structured-interior geometry.";
		}

		return `Three.js is rendering ${cells.length} outdoor-linked structured interior cell${cells.length === 1 ? "" : "s"}.`;
	}

	const focusLabel = formatEnvCellLabel(focusEnvCellId);
	if (cells.length === 0) {
		return `Three.js is waiting for structured-interior geometry around focus ${focusLabel}.`;
	}

	return `Three.js is rendering ${cells.length} structured interior cell${cells.length === 1 ? "" : "s"} around focus ${focusLabel}.`;
}

function describePreparedIndoorCache(assetState: AssetChannelState): string {
	const preparedLandblockPackCount = Object.values(
		assetState.preparedByAssetId,
	).filter((asset) => asset.payload.kind === "landblock-pack").length;

	return `Structured interior cache contains ${preparedLandblockPackCount} prepared landblock pack${preparedLandblockPackCount === 1 ? "" : "s"}.`;
}

function emptyStructuredInteriorSceneModel(
	focusEnvCellId: number | null,
	activeEnvCellIds: number[],
	statusText: string,
	cacheText: string,
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId,
		activeEnvCellIds,
		cells: [],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText,
		cacheText,
	};
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${formatHex32(envCellId)}`;
}
