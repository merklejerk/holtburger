import type { AABB3 } from "../math/types";
import type { ResolvedMapSurface } from "../resolution/presentation";

/**
 * Turn one doorway aperture into a stroke the map can actually draw.
 *
 * A portal aperture is a vertical polygon, so projected straight down it has no area at all and
 * drawing it as geometry would produce nothing. This gives it width instead: the aperture's
 * horizontal footprint is widened across its thin axis into a quad lying flat at the doorway's
 * mid-height, which reads as a mark laid across the gap in a wall.
 *
 * Height matters as well as shape — the quad sits at the aperture's own height so the interior
 * depth and fade rules treat a doorway on another level exactly as they treat the floor there.
 */
export function buildTransitionAccentSurface(
	bounds: AABB3,
	thickness: number,
): ResolvedMapSurface {
	if (!(thickness > 0)) {
		throw new Error("A transition accent needs a positive thickness.");
	}
	const halfThickness = thickness / 2;
	const centerX = (bounds.min.x + bounds.max.x) / 2;
	const centerZ = (bounds.min.z + bounds.max.z) / 2;
	const spanX = bounds.max.x - bounds.min.x;
	const spanZ = bounds.max.z - bounds.min.z;
	// Widen whichever axis the wall is thin along, and leave the doorway's own width alone.
	const halfX = spanX >= spanZ ? spanX / 2 : halfThickness;
	const halfZ = spanX >= spanZ ? halfThickness : spanZ / 2;
	const y = (bounds.min.y + bounds.max.y) / 2;
	return {
		positions: new Float32Array([
			centerX - halfX,
			y,
			centerZ - halfZ,
			centerX + halfX,
			y,
			centerZ - halfZ,
			centerX + halfX,
			y,
			centerZ + halfZ,
			centerX - halfX,
			y,
			centerZ + halfZ,
		]),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	};
}
