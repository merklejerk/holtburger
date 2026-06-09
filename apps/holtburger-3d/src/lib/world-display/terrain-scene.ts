import type { BrowserLocationSelection } from "../../app/browser-mode";
import { isIndoorBrowserDestination } from "../../app/browser-mode";
import type { PreparedAssetResolver } from "../assets/prepared-asset-store";
import type {
	PreparedAssetRecord,
	PreparedTerrainMesh,
} from "../assets/types";
import { deriveTerrainFocusLandblockId } from "../assets/scene-asset-request-planner";
import {
	buildOutdoorCoverageLandblockIds,
	formatLandblockLabel,
	getOutdoorLandblockCoords,
} from "../landblocks";
import {
	buildTerrainMaterialResourcePlan,
	type TerrainMaterialResourcePlan,
} from "./terrain-materials";
import {
	createPreparedTerrainMeshFromOutdoorPayload,
	type LandblockTerrainRenderArtifact,
} from "./terrain-render-artifact";

export interface TerrainSceneTile {
	assetId: string;
	landblockId: number;
	label: string;
	isFocus: boolean;
	chunkLocalOffset: { x: number; y: number; z: number };
	mesh: PreparedTerrainMesh;
	materialResources: TerrainMaterialResourcePlan;
	terrainArtifact: LandblockTerrainRenderArtifact | null;
	dataSource:
		| "repo-local-cell-landblock"
		| "worker-landblock-render-artifact"
		| "generated-fallback"
		| "unknown";
}

export interface TerrainSceneModel {
	focusLandblockId: number | null;
	statusText: string;
	cacheText: string;
	dataSourceText: string;
	tiles: TerrainSceneTile[];
}

export function createEmptyTerrainSceneModel(): TerrainSceneModel {
	return {
		focusLandblockId: null,
		statusText:
			"Waiting for a browser destination before terrain scene selection can start.",
		cacheText: "Terrain cache is idle.",
		dataSourceText: "No terrain provenance available yet.",
		tiles: [],
	};
}

export function deriveTerrainSceneModel(
	preparedAssetResolver: PreparedAssetResolver,
	browserDestination: BrowserLocationSelection | null = null,
	terrainLodRadius = 1,
	terrainLandblockIds: readonly number[] | null = null,
): TerrainSceneModel {
	if (!browserDestination) {
		return {
			focusLandblockId: null,
			statusText:
				"Waiting for a browser destination before terrain scene selection can start.",
			cacheText: `Terrain cache is idle with ${preparedAssetResolver.getPreparedCount()} prepared records.`,
			dataSourceText: "No terrain provenance available yet.",
			tiles: [],
		};
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return {
			focusLandblockId: null,
			statusText:
				"Browser mode is focused on an indoor env cell, so outdoor terrain rendering is dormant.",
			cacheText: `Outdoor terrain cache is holding ${countPreparedTerrainAssets(preparedAssetResolver)} landblocks while indoor browser focus is active.`,
			dataSourceText: describeTerrainDataSources([]),
			tiles: [],
		};
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(browserDestination);
	const activeLandblockIds = new Set(
		terrainLandblockIds ??
			buildOutdoorCoverageLandblockIds(focusLandblockId, terrainLodRadius),
	);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);
	const tiles = [...preparedAssetResolver.values()]
		.flatMap((asset) => {
			const terrainMesh = getTerrainMeshFromPreparedAsset(asset);
			return terrainMesh && asset.payload.kind === "landblock-outdoor"
				? [{ asset, payload: asset.payload, terrainMesh }]
				: [];
		})
		.map(({ asset, payload, terrainMesh }) => {
			const landblockId = terrainMesh.landblockId;

			return {
				assetId: asset.request.assetId,
				landblockId,
				label: formatLandblockLabel(landblockId),
				isFocus: landblockId === focusLandblockId,
				chunkLocalOffset: { x: 0, y: 0, z: 0 },
				mesh: terrainMesh,
				materialResources: buildTerrainMaterialResourcePlan({
					preparedAssetResolver,
					regionNumber: payload.regionNumber,
					quads: terrainMesh.quads,
				}),
				terrainArtifact: null,
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
	const materialText = describeTerrainMaterialResources(
		tiles.map((tile) => tile.materialResources),
	);

	return {
		focusLandblockId,
		statusText: focusTile
			? `Renderer has ${tiles.length} cached outdoor landblock${tiles.length === 1 ? "" : "s"} ready around focus ${focusTile.label}.`
			: `Renderer is waiting for the focus landblock ${formatLandblockLabel(focusLandblockId)} while ${tiles.length} neighbor tile${tiles.length === 1 ? " is" : "s are"} cached.`,
		cacheText: `Terrain cache contains ${countPreparedTerrainAssets(preparedAssetResolver)} prepared landblock payload${countPreparedTerrainAssets(preparedAssetResolver) === 1 ? "" : "s"}; ${materialText}`,
		dataSourceText,
		tiles,
	};
}

function getTerrainMeshFromPreparedAsset(
	asset: PreparedAssetRecord,
): PreparedTerrainMesh | null {
	if (asset.payload.kind === "landblock-outdoor") {
		return createPreparedTerrainMeshFromOutdoorPayload(asset.payload);
	}

	return null;
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
	preparedAssetResolver: PreparedAssetResolver,
): number {
	return [...preparedAssetResolver.values()].filter((asset) =>
		getTerrainMeshFromPreparedAsset(asset),
	).length;
}

function describeTerrainDataSources(
	dataSources: Array<TerrainSceneTile["dataSource"]>,
): string {
	if (dataSources.includes("worker-landblock-render-artifact")) {
		return "Worker-built landblock render artifacts are present in the terrain scene.";
	}

	if (dataSources.includes("repo-local-cell-landblock")) {
		return "Live repo-local CellLandblock payloads are present in the terrain cache.";
	}

	if (dataSources.includes("generated-fallback")) {
		return "Terrain cache entries are using generated fallback payloads because repo-local CellLandblock data could not be loaded.";
	}

	return "No terrain provenance is available yet.";
}

function describeTerrainMaterialResources(
	materialResources: readonly TerrainMaterialResourcePlan[],
): string {
	if (materialResources.length === 0) {
		return "no terrain material resources selected";
	}
	const statusCounts = materialResources.reduce<Record<string, number>>(
		(counts, resources) => {
			counts[resources.status] = (counts[resources.status] ?? 0) + 1;
			return counts;
		},
		{},
	);
	const missingSurfaceTextures = materialResources.reduce(
		(total, resources) =>
			total + resources.missingSurfaceTextureAssetIds.length,
		0,
	);
	const missingRenderSurfaces = materialResources.reduce(
		(total, resources) => total + resources.missingRenderSurfaceAssetIds.length,
		0,
	);
	const unsupportedRenderSurfaces = materialResources.reduce(
		(total, resources) =>
			total + resources.unsupportedRenderSurfaceAssetIds.length,
		0,
	);
	return `terrain material prep ${JSON.stringify(statusCounts)}, missing surface textures ${missingSurfaceTextures}, missing render surfaces ${missingRenderSurfaces}, unsupported surfaces ${unsupportedRenderSurfaces}`;
}

function inferTerrainDataSource(
	asset: PreparedAssetRecord,
): TerrainSceneTile["dataSource"] {
	if (asset.payload.kind === "landblock-outdoor") {
		return asset.payload.provenance.source === "repo-local-hba"
			? "repo-local-cell-landblock"
			: "unknown";
	}

	return "unknown";
}
