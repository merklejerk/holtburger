import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import type { ResolvedDistanceFog } from "./scene-environment";

/** Terrain interest radius used to derive a stable presentation-only fog range. */
export interface TerrainFogCoverage {
	/** Chebyshev landblock radius selected for retained outdoor terrain. */
	readonly terrainRadius: number;
}

/**
 * Rescale region-authored fog to the selected terrain-interest radius.
 *
 * Region data retains the fog color and near/far ratio. Terrain interest owns the absolute
 * visibility distance, so expanding its radius makes the extra terrain visible rather than
 * loading it behind an unchanged fog wall. The shader measures this range from its camera;
 * Explorer intentionally does not shrink it near the edge of a retained interest window.
 */
export function resolveTerrainCoverageFog(
	authoredFog: ResolvedDistanceFog | null,
	coverage: TerrainFogCoverage | null,
): ResolvedDistanceFog | null {
	if (authoredFog === null || coverage === null) return authoredFog;
	if (
		!Number.isFinite(authoredFog.near) ||
		!Number.isFinite(authoredFog.far) ||
		authoredFog.near < 0 ||
		authoredFog.far <= 0 ||
		authoredFog.near > authoredFog.far
	) {
		throw new Error("Authored terrain fog must have a finite non-empty range.");
	}
	if (
		!Number.isSafeInteger(coverage.terrainRadius) ||
		coverage.terrainRadius < 0
	) {
		throw new Error(
			"Terrain fog coverage requires a non-negative integer radius.",
		);
	}
	const distance =
		(coverage.terrainRadius + 0.5) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	return {
		near: distance * (authoredFog.near / authoredFog.far),
		far: distance,
		color: authoredFog.color,
	};
}
