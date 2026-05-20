import {
	buildOutdoorCoverageLandblockIds,
	normalizeOutdoorLandblockId,
} from "../landblocks";

export interface OutdoorSceneInterest {
	focusLandblockId: number;
	terrainRadius: number;
	buildingRadius: number;
	detailRadius: number;
	envCellRadius: number;
}

interface OutdoorSceneInterestLandblocks {
	terrainLandblockIds: readonly number[];
	buildingLandblockIds: readonly number[];
	detailLandblockIds: readonly number[];
	envCellLandblockIds: readonly number[];
}

export interface NormalizedOutdoorSceneInterest
	extends OutdoorSceneInterest, OutdoorSceneInterestLandblocks {}

export const MIN_OUTDOOR_SCENE_LOD_RADIUS = 0;
export const MAX_OUTDOOR_SCENE_LOD_RADIUS = 8;
export const DEFAULT_TERRAIN_LOD_RADIUS = 2;
export const DEFAULT_BUILDING_LOD_RADIUS = 1;
export const DEFAULT_DETAIL_LOD_RADIUS = 1;
export const DEFAULT_ENV_CELL_LOD_RADIUS = 1;

export function createDefaultOutdoorSceneInterest(
	focusLandblockId: number,
): NormalizedOutdoorSceneInterest {
	return deriveOutdoorSceneInterest({
		focusLandblockId,
		terrainRadius: DEFAULT_TERRAIN_LOD_RADIUS,
		buildingRadius: DEFAULT_BUILDING_LOD_RADIUS,
		detailRadius: DEFAULT_DETAIL_LOD_RADIUS,
		envCellRadius: DEFAULT_ENV_CELL_LOD_RADIUS,
	});
}

export function deriveOutdoorSceneInterest(
	interest: OutdoorSceneInterest,
): NormalizedOutdoorSceneInterest {
	const terrainRadius = clampOutdoorSceneLodRadius(interest.terrainRadius);
	const buildingRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.buildingRadius),
		terrainRadius,
	);
	const detailRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.detailRadius),
		buildingRadius,
	);
	const envCellRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.envCellRadius),
		terrainRadius,
	);
	const focusLandblockId = normalizeOutdoorLandblockId(
		interest.focusLandblockId,
	);

	return {
		focusLandblockId,
		terrainRadius,
		buildingRadius,
		detailRadius,
		envCellRadius,
		terrainLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			terrainRadius,
		),
		buildingLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			buildingRadius,
		),
		detailLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			detailRadius,
		),
		envCellLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			envCellRadius,
		),
	};
}

export function clampOutdoorSceneLodRadius(radius: number): number {
	if (!Number.isFinite(radius)) {
		return MIN_OUTDOOR_SCENE_LOD_RADIUS;
	}

	return Math.max(
		MIN_OUTDOOR_SCENE_LOD_RADIUS,
		Math.min(MAX_OUTDOOR_SCENE_LOD_RADIUS, Math.trunc(radius)),
	);
}

export function unionOutdoorSceneLandblockIds(
	leftLandblockIds: readonly number[],
	rightLandblockIds: readonly number[],
): number[] {
	return [...new Set([...leftLandblockIds, ...rightLandblockIds])].sort(
		(left, right) => left - right,
	);
}

export function countOutdoorSceneLodTiles(radius: number): number {
	return (clampOutdoorSceneLodRadius(radius) * 2 + 1) ** 2;
}
