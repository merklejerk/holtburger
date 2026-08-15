import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import type { ResolvedDistanceFog } from "./scene-environment";

/**
 * Landblock ring at or beyond which terrain renders as one flat color.
 *
 * Fog supplies the derivation and landblocks supply the unit. Terrain fog is linear
 * (`webgl2-fog.ts`), so the configured coverage fraction lands at a plain interpolation between
 * `near` and `far`, and that distance converts to whole landblocks.
 *
 * Landblocks rather than world distance because the residency window, scene interest, and the
 * anchor are all already expressed that way, and because a landblock ring is stable: the solid set
 * changes only when the anchor does, so a landblock near the boundary cannot flicker between flat
 * and composited as the camera moves within its own landblock.
 *
 * Returns `null` when fog is disabled, so nothing goes flat without fog to hide the seam. Null
 * rather than `Infinity` because callers must handle "never" explicitly, and because `Infinity`
 * does not survive the JSON boundary that carries renderer diagnostics.
 */
export function solidTerrainCutoffLandblocks(
	fog: ResolvedDistanceFog | null,
): number | null {
	if (fog === null) return null;
	const coverage = FRONTEND_TUNING.rendering.solidTerrainFogCoverage;
	const distance = fog.near + (fog.far - fog.near) * coverage;
	return Math.ceil(distance / OUTDOOR_LANDBLOCK_WORLD_SIZE);
}

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
