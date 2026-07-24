import { createOutdoorTerrainWindowBounds } from "../landblocks";
import { distanceToBoundsEdge2D } from "../math/geometry-utils";
import { Vec2, type Vec3 } from "../math/types";
import type { LandblockId } from "../game-types";
import type { ResolvedDistanceFog } from "./scene-environment";

/** Static terrain window against which a camera's safe fog radius is resolved. */
export interface TerrainFogCoverage {
	/** Outdoor landblock at the center of the retained terrain window. */
	readonly anchorLandblockId: LandblockId;
	/** Chebyshev landblock radius retained around the anchor. */
	readonly terrainRadius: number;
}

/**
 * Rescale region-authored fog to the horizontally available terrain around one camera.
 *
 * Region data retains the fog color and near/far ratio.  Terrain interest owns the absolute
 * visibility distance, so expanding its radius makes the extra terrain visible rather than
 * loading it behind an unchanged fog wall.  The coverage window is evaluated in scene X/Z only;
 * camera altitude must not affect terrain visibility policy.
 */
export function resolveTerrainCoverageFog(
	authoredFog: ResolvedDistanceFog | null,
	coverage: TerrainFogCoverage | null,
	cameraPosition: Vec3,
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
	const distance = distanceToBoundsEdge2D(
		createOutdoorTerrainWindowBounds(
			coverage.anchorLandblockId,
			coverage.terrainRadius,
		),
		new Vec2(cameraPosition.x, cameraPosition.z),
	);
	return {
		near: distance * (authoredFog.near / authoredFog.far),
		far: distance,
		color: authoredFog.color,
	};
}
