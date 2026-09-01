import { transformPoint3 } from "../math/matrices";
import type { AABB3, Mat4 } from "../math/types";
import { Vec3 } from "../math/types";

export interface ResolvedNameplateAnchor {
	/** Entity-top position in the current view's anchor-relative renderer space. */
	readonly anchor: Vec3;
	/** Squared camera distance used by the per-view budget without a square root. */
	readonly distanceSquared: number;
}

/** Resolve one current rigid-bounds top anchor through entity and landblock transforms. */
export function resolveNameplateAnchor(
	rigidBounds: AABB3,
	localToLandblock: Mat4,
	landblockOffset: Vec3,
	cameraPosition: Vec3,
	anchorPaddingWorldUnits: number,
): ResolvedNameplateAnchor {
	const localAnchor = new Vec3(
		(rigidBounds.min.x + rigidBounds.max.x) * 0.5,
		rigidBounds.max.y + anchorPaddingWorldUnits,
		(rigidBounds.min.z + rigidBounds.max.z) * 0.5,
	);
	const landblockAnchor = transformPoint3(localToLandblock, localAnchor);
	const anchor = landblockAnchor.add(landblockOffset);
	return { anchor, distanceSquared: anchor.distanceSquaredTo(cameraPosition) };
}
