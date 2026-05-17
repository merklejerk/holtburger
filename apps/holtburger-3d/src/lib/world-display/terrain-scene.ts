import type { BrowserLocationSelection } from "../../app/browser-mode";
import { isIndoorBrowserDestination } from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedTerrainMesh,
} from "../assets/types";
import { isPreparedTerrainLandblock } from "../assets/types";
import type { RuntimeBatchDto } from "../host/contracts";
import { deriveTerrainFocusLandblockId } from "../assets/scene-asset-request-planner";
import {
	buildOutdoorCoverageLandblockIds,
	formatLandblockLabel,
	getOutdoorLandblockCoords,
} from "../landblocks";
import {
	deriveTerrainTileRenderChunk,
	type RenderChunkPlacement,
} from "./render-chunks";

export interface TerrainSceneTile {
	assetId: string;
	landblockId: number;
	renderChunk: RenderChunkPlacement;
	label: string;
	isFocus: boolean;
	chunkLocalOffset: { x: number; y: number; z: number };
	mesh: PreparedTerrainMesh;
	dataSource: "repo-local-cell-landblock" | "generated-fallback" | "unknown";
}

export interface TerrainSceneModel {
	focusLandblockId: number | null;
	statusText: string;
	cacheText: string;
	dataSourceText: string;
	tiles: TerrainSceneTile[];
}

export function deriveTerrainSceneModel(
	runtimeBatch: RuntimeBatchDto | null,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	terrainLodRadius = 1,
	terrainLandblockIds: readonly number[] | null = null,
): TerrainSceneModel {
	if (!runtimeBatch) {
		return {
			focusLandblockId: null,
			statusText:
				"Waiting for runtime residency before the Three.js terrain scene can select landblocks.",
			cacheText: `Terrain cache is idle with ${Object.keys(assetState.preparedByAssetId).length} prepared records.`,
			dataSourceText: "No terrain provenance available yet.",
			tiles: [],
		};
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return {
			focusLandblockId: null,
			statusText:
				"Browser mode is focused on an indoor env cell, so outdoor terrain rendering is dormant.",
			cacheText: `Outdoor terrain cache is holding ${countPreparedTerrainAssets(assetState.preparedByAssetId)} landblocks while indoor browser focus is active.`,
			dataSourceText: describeTerrainDataSources([]),
			tiles: [],
		};
	}

	if (runtimeBatch.residency.indoors) {
		return {
			focusLandblockId: null,
			statusText:
				"Indoor runtime residency is active, so the outdoor Three.js terrain scene is intentionally dormant until env-cell scene ownership lands.",
			cacheText: `Outdoor terrain cache is holding ${countPreparedTerrainAssets(assetState.preparedByAssetId)} landblocks while indoor scene work remains deferred.`,
			dataSourceText: describeTerrainDataSources([]),
			tiles: [],
		};
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const activeLandblockIds = new Set(
		terrainLandblockIds ??
			buildOutdoorCoverageLandblockIds(focusLandblockId, terrainLodRadius),
	);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);
	const tiles = Object.values(assetState.preparedByAssetId)
		.filter(
			(
				asset,
			): asset is PreparedAssetRecord & {
				payload: { terrainMesh: PreparedTerrainMesh };
			} => isPreparedTerrainLandblock(asset),
		)
		.map((asset) => {
			const landblockId = asset.payload.terrainMesh.landblockId;
			const renderChunk = deriveTerrainTileRenderChunk(landblockId);

			return {
				assetId: asset.request.assetId,
				landblockId,
				renderChunk,
				label: formatLandblockLabel(landblockId),
				isFocus: landblockId === focusLandblockId,
				chunkLocalOffset: { x: 0, y: 0, z: 0 },
				mesh: asset.payload.terrainMesh,
				dataSource: inferTerrainDataSource(asset),
			};
		})
		.filter((tile) => activeLandblockIds.has(tile.landblockId))
		.sort((left, right) => {
			if (left.isFocus !== right.isFocus) {
				return left.isFocus ? -1 : 1;
			}
			return compareLandblockGridPosition(
				left.landblockId,
				right.landblockId,
				focusCoords,
			);
		});

	const focusTile = tiles.find((tile) => tile.isFocus) ?? null;
	const dataSourceText = describeTerrainDataSources(
		tiles.map((tile) => tile.dataSource),
	);

	return {
		focusLandblockId,
		statusText: focusTile
			? `Three.js is rendering ${tiles.length} cached outdoor landblock${tiles.length === 1 ? "" : "s"} around focus ${focusTile.label}.`
			: `Three.js is waiting for the focus landblock ${formatLandblockLabel(focusLandblockId)} while ${tiles.length} neighbor tile${tiles.length === 1 ? " is" : "s are"} cached.`,
		cacheText: `Terrain cache contains ${countPreparedTerrainAssets(assetState.preparedByAssetId)} prepared landblock payload${countPreparedTerrainAssets(assetState.preparedByAssetId) === 1 ? "" : "s"}.`,
		dataSourceText,
		tiles,
	};
}

function compareLandblockGridPosition(
	leftLandblockId: number,
	rightLandblockId: number,
	focusCoords: { x: number; y: number },
): number {
	const leftCoords = getOutdoorLandblockCoords(leftLandblockId);
	const rightCoords = getOutdoorLandblockCoords(rightLandblockId);
	const leftDeltaY = leftCoords.y - focusCoords.y;
	const rightDeltaY = rightCoords.y - focusCoords.y;
	if (leftDeltaY !== rightDeltaY) {
		return leftDeltaY - rightDeltaY;
	}
	return leftCoords.x - focusCoords.x - (rightCoords.x - focusCoords.x);
}

function countPreparedTerrainAssets(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): number {
	return Object.values(preparedByAssetId).filter((asset) =>
		isPreparedTerrainLandblock(asset),
	).length;
}

function describeTerrainDataSources(
	dataSources: Array<TerrainSceneTile["dataSource"]>,
): string {
	if (dataSources.includes("repo-local-cell-landblock")) {
		return "Live repo-local CellLandblock payloads are present in the terrain cache.";
	}

	if (dataSources.includes("generated-fallback")) {
		return "Terrain cache entries are using generated fallback payloads because repo-local CellLandblock data could not be loaded.";
	}

	return "No terrain provenance is available yet.";
}

function inferTerrainDataSource(
	asset: PreparedAssetRecord,
): TerrainSceneTile["dataSource"] {
	if (asset.payload.provenance.source === "repo-local-hba") {
		return "repo-local-cell-landblock";
	}

	if (asset.payload.provenance.source === "generated-fallback") {
		return "generated-fallback";
	}

	return "unknown";
}
