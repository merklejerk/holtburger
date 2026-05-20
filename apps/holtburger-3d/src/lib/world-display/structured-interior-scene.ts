import {
	browserDestinationToIndoorEnvCellId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedEnvironmentCellStruct,
	PreparedAssetRecord,
	PreparedEnvironmentPayload,
	PreparedIndoorCellPortal,
	PreparedLandblockInteriorCell,
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
	formatEnvironmentAssetId,
	formatIndoorEnvCellAssetId,
	isPreparedIndoorEnvCellAsset,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto, RuntimeBatchDto } from "../host/contracts";
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
	staticObjectCount: number;
	cellStructure: PreparedEnvironmentCellStruct | null;
	renderGeometry: PreparedPolygonSetRenderGeometry;
	debugColorKey: string;
}

export interface StructuredInteriorSceneModel {
	focusEnvCellId: number | null;
	activeEnvCellIds: number[];
	cells: StructuredInteriorCell[];
	missingEnvCellAssetIds: string[];
	missingEnvironmentAssetIds: string[];
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
	runtimeBatch: RuntimeBatchDto | null,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	linkedOutdoorInteriors: LinkedOutdoorInteriorSelection | null = null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
): StructuredInteriorSceneModel {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveBrowserFocusedStructuredInteriorSceneModel(
			browserFocusEnvCellId,
			assetState,
			structuredInteriorCoverage,
		);
	}

	if (!runtimeBatch || !runtimeBatch.residency.indoors) {
		if (
			linkedOutdoorInteriors &&
			linkedOutdoorInteriors.envCellIds.length > 0
		) {
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
			"Structured interior scene is dormant while outdoor residency is active.",
			"Structured interior cache is idle.",
		);
	}

	const focusEnvCellId = runtimeBatch.residency.focusEnvCellId;
	if (focusEnvCellId === null) {
		return emptyStructuredInteriorSceneModel(
			null,
			[],
			"Indoor residency is active, but no focus env cell is available yet.",
			describePreparedIndoorCache(assetState),
		);
	}

	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		{
			kind: "landblock-closure",
			seedEnvCellIds: [
				focusEnvCellId,
				...runtimeBatch.residency.visibleCellIds,
			],
		},
		assetState.preparedByAssetId,
	).envCellIds;
	return deriveStructuredInteriorSceneForEnvCells(
		focusEnvCellId,
		activeEnvCellIds,
		assetState,
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
	const missingEnvCellAssetIds = new Set<string>();
	const missingEnvironmentAssetIds = new Set<string>();
	const missingCellStructureKeys = new Set<string>();
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
					`landblock-pack/${formatHex32(envCellId & 0xffff0000)}/env-cell/${formatHex32(envCellId)}`,
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
				staticObjectCount: packCell.staticObjectCount,
				cellStructure: null,
				renderGeometry: packCell.renderGeometry,
				debugColorKey: `landblock-pack:${envCellId}:${packCell.environmentId}:${formatHex32(packCell.cellStructureId)}`,
			});
			continue;
		}

		const envCellAssetId = formatIndoorEnvCellAssetId(envCellId);
		const envCellAsset = assetState.preparedByAssetId[envCellAssetId];
		if (!isPreparedIndoorEnvCellAsset(envCellAsset)) {
			missingEnvCellAssetIds.add(envCellAssetId);
			continue;
		}

		const { environmentId, cellStructureId } = envCellAsset.payload;
		if (environmentId === null || cellStructureId === null) {
			missingCellStructureKeys.add(`${envCellAssetId}:unselected`);
			continue;
		}

		const environmentAssetId = formatEnvironmentAssetId(environmentId);
		const environmentAsset = assetState.preparedByAssetId[environmentAssetId];
		if (!isPreparedEnvironmentAsset(environmentAsset)) {
			missingEnvironmentAssetIds.add(environmentAssetId);
			continue;
		}

		const cellStructure = environmentAsset.payload.cellStructures.find(
			(entry) => entry.id === cellStructureId,
		);
		if (!cellStructure) {
			missingCellStructureKeys.add(
				`${environmentAssetId}:cell-structure/${formatHex32(cellStructureId)}`,
			);
			continue;
		}

		if (cellStructure.renderGeometry.vertexCount === 0) {
			continue;
		}

		const renderChunk = deriveStructuredCellRenderChunk(envCellId);
		const localRenderKey = `${envCellAssetId}/${environmentAssetId}/cell-structure/${formatHex32(cellStructureId)}`;
		cells.push({
			renderKey: formatRenderDomainKey(
				WORLD_RENDER_DOMAIN.interiorCellShell,
				localRenderKey,
			),
			envCellId,
			renderChunk,
			environmentId,
			cellStructureId,
			isFocus: focusEnvCellId !== null && envCellId === focusEnvCellId,
			chunkLocalPlacement: envCellAsset.payload.localPlacement,
			surfaceIds: envCellAsset.payload.surfaceIds,
			portalCount: envCellAsset.payload.portalCount,
			portals: envCellAsset.payload.portals,
			staticObjectCount: envCellAsset.payload.staticObjectCount,
			cellStructure,
			renderGeometry: cellStructure.renderGeometry,
			debugColorKey: `${envCellAssetId}:${environmentAssetId}:${formatHex32(cellStructureId)}`,
		});
	}

	return {
		focusEnvCellId,
		activeEnvCellIds,
		cells: cells.sort(compareStructuredInteriorCells),
		missingEnvCellAssetIds: [...missingEnvCellAssetIds].sort(),
		missingEnvironmentAssetIds: [...missingEnvironmentAssetIds].sort(),
		missingCellStructureKeys: [...missingCellStructureKeys].sort(),
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

function isPreparedEnvironmentAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedEnvironmentPayload } {
	return asset?.payload.kind === "environment";
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
	const preparedIndoorEnvCellCount = Object.values(
		assetState.preparedByAssetId,
	).filter(isPreparedIndoorEnvCellAsset).length;
	const preparedEnvironmentCount = Object.values(
		assetState.preparedByAssetId,
	).filter(isPreparedEnvironmentAsset).length;

	return `Structured interior cache contains ${preparedIndoorEnvCellCount} prepared env-cell metadata payload${preparedIndoorEnvCellCount === 1 ? "" : "s"} and ${preparedEnvironmentCount} prepared environment payload${preparedEnvironmentCount === 1 ? "" : "s"}.`;
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
		missingEnvironmentAssetIds: [],
		missingCellStructureKeys: [],
		statusText,
		cacheText,
	};
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${formatHex32(envCellId)}`;
}
