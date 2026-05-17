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
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import {
	createDefaultStructuredInteriorCoverageOptions,
	deriveStructuredInteriorCoverage,
	formatEnvironmentAssetId,
	formatIndoorEnvCellAssetId,
	isPreparedIndoorEnvCellAsset,
	type StructuredInteriorCoverage,
	type StructuredInteriorCoverageOptions,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto, RuntimeBatchDto } from "../host/contracts";
import { formatHex32 } from "../landblocks";
import {
	deriveFocusRelativeAcPlacementOffset,
	deriveStructuredCellRenderChunk,
	type RenderChunkPlacement,
} from "./render-chunks";

export interface LinkedOutdoorInteriorSelection {
	envCellIds: number[];
	focusLandblockId: number;
}

export interface StructuredInteriorCell {
	renderKey: string;
	envCellId: number;
	renderChunk: RenderChunkPlacement;
	environmentId: number;
	cellStructureId: number;
	isFocus: boolean;
	chunkLocalPlacement: PlacementTransformDto;
	localPlacement: PlacementTransformDto;
	landblockWorldOffset: { x: number; y: number; z: number };
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

export function deriveStructuredInteriorSceneModel(
	runtimeBatch: RuntimeBatchDto | null,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	linkedOutdoorInteriors: LinkedOutdoorInteriorSelection | null = null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
	structuredInteriorCoverageOptions: StructuredInteriorCoverageOptions = createDefaultStructuredInteriorCoverageOptions(),
): StructuredInteriorSceneModel {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveBrowserFocusedStructuredInteriorSceneModel(
			browserFocusEnvCellId,
			assetState,
			structuredInteriorCoverage,
			structuredInteriorCoverageOptions,
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
							kind: "visible-cell-closure",
							seedEnvCellIds: linkedOutdoorInteriors.envCellIds,
						},
						assetState.preparedByAssetId,
						structuredInteriorCoverageOptions,
					).envCellIds,
				assetState,
				linkedOutdoorInteriors.focusLandblockId,
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
			kind: "direct",
			envCellIds: [focusEnvCellId, ...runtimeBatch.residency.visibleCellIds],
		},
		assetState.preparedByAssetId,
		structuredInteriorCoverageOptions,
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
	structuredInteriorCoverageOptions: StructuredInteriorCoverageOptions,
): StructuredInteriorSceneModel {
	const activeEnvCellIds =
		structuredInteriorCoverage?.envCellIds ??
		deriveStructuredInteriorCoverage(
			{
				kind: "visible-cell-closure",
				seedEnvCellIds: [focusEnvCellId],
			},
			assetState.preparedByAssetId,
			structuredInteriorCoverageOptions,
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
	outdoorFocusLandblockId: number | null = null,
): StructuredInteriorSceneModel {
	const missingEnvCellAssetIds = new Set<string>();
	const missingEnvironmentAssetIds = new Set<string>();
	const missingCellStructureKeys = new Set<string>();
	const cells: StructuredInteriorCell[] = [];

	for (const envCellId of activeEnvCellIds) {
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
		const localPlacement = envCellAsset.payload.localPlacement;
		cells.push({
			renderKey: `${envCellAssetId}/${environmentAssetId}/cell-structure/${formatHex32(cellStructureId)}`,
			envCellId,
			renderChunk,
			environmentId,
			cellStructureId,
			isFocus: focusEnvCellId !== null && envCellId === focusEnvCellId,
			chunkLocalPlacement: localPlacement,
			localPlacement,
			landblockWorldOffset:
				outdoorFocusLandblockId === null
					? { x: 0, y: 0, z: 0 }
					: deriveLandblockWorldOffset(envCellId, outdoorFocusLandblockId),
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

function deriveLandblockWorldOffset(
	envCellId: number,
	focusLandblockId: number,
): { x: number; y: number; z: number } {
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	return deriveFocusRelativeAcPlacementOffset(
		renderChunk.chunkLandblockId,
		focusLandblockId,
	);
}
