import {
	browserDestinationToIndoorEnvCellId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedEnvironmentPayload,
	PreparedIndoorEnvCellPayload,
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { PlacementTransformDto, RuntimeBatchDto } from "../host/contracts";
import { formatHex32 } from "../landblocks";

export interface StructuredInteriorCell {
	renderKey: string;
	envCellId: number;
	environmentId: number;
	cellStructureId: number;
	isFocus: boolean;
	localPlacement: PlacementTransformDto;
	surfaceIds: number[];
	portalCount: number;
	staticObjectCount: number;
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
): StructuredInteriorSceneModel {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveBrowserFocusedStructuredInteriorSceneModel(
			browserFocusEnvCellId,
			assetState,
		);
	}

	if (!runtimeBatch || !runtimeBatch.residency.indoors) {
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

	const activeEnvCellIds = [
		...new Set([focusEnvCellId, ...runtimeBatch.residency.visibleCellIds]),
	].sort((left, right) => left - right);
	return deriveStructuredInteriorSceneForEnvCells(
		focusEnvCellId,
		activeEnvCellIds,
		assetState,
	);
}

function deriveBrowserFocusedStructuredInteriorSceneModel(
	focusEnvCellId: number,
	assetState: AssetChannelState,
): StructuredInteriorSceneModel {
	const focusEnvCellAsset =
		assetState.preparedByAssetId[formatIndoorEnvCellAssetId(focusEnvCellId)];
	const activeEnvCellIds = isPreparedIndoorEnvCellAsset(focusEnvCellAsset)
		? [
				...new Set([
					focusEnvCellId,
					...focusEnvCellAsset.payload.visibleCellIds,
				]),
			].sort((left, right) => left - right)
		: [focusEnvCellId];

	return deriveStructuredInteriorSceneForEnvCells(
		focusEnvCellId,
		activeEnvCellIds,
		assetState,
	);
}

function deriveStructuredInteriorSceneForEnvCells(
	focusEnvCellId: number,
	activeEnvCellIds: number[],
	assetState: AssetChannelState,
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

		cells.push({
			renderKey: `${envCellAssetId}/${environmentAssetId}/cell-structure/${formatHex32(cellStructureId)}`,
			envCellId,
			environmentId,
			cellStructureId,
			isFocus: envCellId === focusEnvCellId,
			localPlacement: envCellAsset.payload.localPlacement,
			surfaceIds: envCellAsset.payload.surfaceIds,
			portalCount: envCellAsset.payload.portalCount,
			staticObjectCount: envCellAsset.payload.staticObjectCount,
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

function isPreparedIndoorEnvCellAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedIndoorEnvCellPayload } {
	return asset?.payload.kind === "indoor-env-cell";
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
	focusEnvCellId: number,
): string {
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

function formatIndoorEnvCellAssetId(envCellId: number): string {
	return `indoor-env-cell/${formatHex32(envCellId)}`;
}

function formatEnvironmentAssetId(environmentId: number): string {
	return `environment/${formatHex32(environmentId)}`;
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${formatHex32(envCellId)}`;
}
