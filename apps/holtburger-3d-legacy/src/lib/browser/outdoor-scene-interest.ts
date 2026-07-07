import {
	buildOutdoorCoverageLandblockIds,
	isOutdoorCoverageOffsetIncluded,
	normalizeOutdoorLandblockId,
} from "../landblocks";

export interface OutdoorSceneInterest {
	focusLandblockId: number;
	terrainRadius: number;
	buildingRadius: number;
	explicitObjectRadius: number;
	generatedSceneryRadius: number;
	envCellRadius: number;
}

interface OutdoorSceneInterestLandblocks {
	terrainLandblockIds: readonly number[];
	buildingLandblockIds: readonly number[];
	explicitObjectLandblockIds: readonly number[];
	generatedSceneryLandblockIds: readonly number[];
	envCellLandblockIds: readonly number[];
}

export interface NormalizedOutdoorSceneInterest
	extends OutdoorSceneInterest, OutdoorSceneInterestLandblocks {}

export const MIN_OUTDOOR_SCENE_LOD_RADIUS = 0;
export const MAX_OUTDOOR_SCENE_LOD_RADIUS = 8;
export const DEFAULT_TERRAIN_LOD_RADIUS = 2;
export const DEFAULT_BUILDING_LOD_RADIUS = 1;
export const DEFAULT_EXPLICIT_OBJECT_LOD_RADIUS = 1;
export const DEFAULT_GENERATED_SCENERY_LOD_RADIUS = 1;
export const DEFAULT_ENV_CELL_LOD_RADIUS = 1;

export function deriveOutdoorSceneInterest(
	interest: OutdoorSceneInterest,
): NormalizedOutdoorSceneInterest {
	const terrainRadius = clampOutdoorSceneLodRadius(interest.terrainRadius);
	const buildingRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.buildingRadius),
		terrainRadius,
	);
	const explicitObjectRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.explicitObjectRadius),
		buildingRadius,
	);
	const generatedSceneryRadius = Math.min(
		clampOutdoorSceneLodRadius(interest.generatedSceneryRadius),
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
		explicitObjectRadius,
		generatedSceneryRadius,
		envCellRadius,
		terrainLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			terrainRadius,
		),
		buildingLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			buildingRadius,
		),
		explicitObjectLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			explicitObjectRadius,
		),
		generatedSceneryLandblockIds: buildOutdoorCoverageLandblockIds(
			focusLandblockId,
			generatedSceneryRadius,
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
	const clampedRadius = clampOutdoorSceneLodRadius(radius);
	let tileCount = 0;

	for (let offsetY = -clampedRadius; offsetY <= clampedRadius; offsetY += 1) {
		for (let offsetX = -clampedRadius; offsetX <= clampedRadius; offsetX += 1) {
			if (isOutdoorCoverageOffsetIncluded(offsetX, offsetY, clampedRadius)) {
				tileCount += 1;
			}
		}
	}

	return tileCount;
}
