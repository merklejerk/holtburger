import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { AssetChannelState, PreparedAssetRecord, PreparedTerrainMesh } from "../assets/types";
import type { RuntimeBatchDto } from "../host/contracts";
import { deriveTerrainFocusLandblockId } from "../assets/asset-channel";

export interface TerrainSceneTile {
	assetId: string;
	landblockId: number;
	label: string;
	isFocus: boolean;
	offsetX: number;
	offsetY: number;
	worldOffsetX: number;
	worldOffsetY: number;
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
): TerrainSceneModel {
	if (!runtimeBatch) {
		return {
			focusLandblockId: null,
			statusText: "Waiting for runtime residency before the Three.js terrain scene can select landblocks.",
			cacheText: `Terrain cache is idle with ${Object.keys(assetState.preparedByAssetId).length} prepared records.`,
			dataSourceText: "No terrain provenance available yet.",
			tiles: [],
		};
	}

	if (runtimeBatch.residency.indoors) {
		return {
			focusLandblockId: null,
			statusText: "Indoor runtime residency is active, so the outdoor Three.js terrain scene is intentionally dormant until env-cell scene ownership lands.",
			cacheText: `Outdoor terrain cache is holding ${countPreparedTerrainAssets(assetState.preparedByAssetId)} landblocks while indoor scene work remains deferred.`,
			dataSourceText: describeTerrainDataSources([]),
			tiles: [],
		};
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(runtimeBatch, browserDestination);
	const focusX = (focusLandblockId >>> 24) & 0xff;
	const focusY = (focusLandblockId >>> 16) & 0xff;
	const tiles = Object.values(assetState.preparedByAssetId)
		.filter((asset): asset is PreparedAssetRecord & { terrainMesh: PreparedTerrainMesh } =>
			asset.assetKind === "terrain-landblock" && asset.terrainMesh !== null,
		)
		.map((asset) => {
			const landblockId = asset.terrainMesh.landblockId;
			const landblockX = (landblockId >>> 24) & 0xff;
			const landblockY = (landblockId >>> 16) & 0xff;
			const offsetX = landblockX - focusX;
			const offsetY = landblockY - focusY;
			const landblockSpan = (asset.terrainMesh.gridSize - 1) * asset.terrainMesh.tileSize;

			return {
				assetId: asset.request.assetId,
				landblockId,
				label: formatLandblockLabel(landblockId),
				isFocus: landblockId === focusLandblockId,
				offsetX,
				offsetY,
				worldOffsetX: offsetX * landblockSpan,
				worldOffsetY: offsetY * landblockSpan,
				mesh: asset.terrainMesh,
				dataSource: inferTerrainDataSource(asset),
			};
		})
		.filter((tile) => Math.abs(tile.offsetX) <= 1 && Math.abs(tile.offsetY) <= 1)
		.sort((left, right) => {
			if (left.isFocus !== right.isFocus) {
				return left.isFocus ? -1 : 1;
			}
			if (left.offsetY !== right.offsetY) {
				return left.offsetY - right.offsetY;
			}
			return left.offsetX - right.offsetX;
		});

	const focusTile = tiles.find((tile) => tile.isFocus) ?? null;
	const dataSourceText = describeTerrainDataSources(tiles.map((tile) => tile.dataSource));

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

function countPreparedTerrainAssets(preparedByAssetId: Record<string, PreparedAssetRecord>): number {
	return Object.values(preparedByAssetId).filter(
		(asset) => asset.assetKind === "terrain-landblock" && asset.terrainMesh !== null,
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
	if (asset.provenance.source === "repo-local-hba") {
		return "repo-local-cell-landblock";
	}

	if (asset.provenance.source === "generated-fallback") {
		return "generated-fallback";
	}

	return "unknown";
}

function formatLandblockLabel(landblockId: number): string {
	return `0x${landblockId.toString(16).padStart(8, "0")}`;
}