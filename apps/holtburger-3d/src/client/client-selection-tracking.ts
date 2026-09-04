import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../lib/game/landblocks";
import { transformAABB3 } from "../lib/game/math/matrices";
import { Vec3 } from "../lib/game/math/types";
import type { SelectedDynamicEntityFrame } from "../lib/game/runtime/game-presentation-runtime";
import type { PrimaryCameraView } from "../lib/game/runtime/types";

/** Current presentation-owned evidence consumed by app-local selection validity policy. */
export type ClientSelectedEntityTrackingStatus =
	| { readonly kind: "tracked"; readonly distance: number }
	| { readonly kind: "frontend-evicted" }
	| { readonly kind: "temporarily-unrealized" };

/** Measure from the presented camera to the nearest point of the transformed rigid AABB. */
export function clientSelectedEntityDistance(
	view: PrimaryCameraView,
	selected: SelectedDynamicEntityFrame,
): number {
	const cameraLandblockId = view.camera.placement.landblockId;
	const cameraOrigin = createLandblockWorldOrigin(cameraLandblockId);
	const camera = new Vec3(
		view.camera.placement.position.x - cameraOrigin.x,
		view.camera.placement.position.y,
		view.camera.placement.position.z - cameraOrigin.z,
	);
	const bounds = transformAABB3(
		selected.placement.localToLandblock,
		selected.localBounds,
	);
	const offset = createLandblockOffset(
		getLandblockCoordinates(selected.placement.landblockId),
		getLandblockCoordinates(cameraLandblockId),
	);
	const x = Math.max(
		bounds.min.x + offset.x - camera.x,
		0,
		camera.x - (bounds.max.x + offset.x),
	);
	const y = Math.max(
		bounds.min.y + offset.y - camera.y,
		0,
		camera.y - (bounds.max.y + offset.y),
	);
	const z = Math.max(
		bounds.min.z + offset.z - camera.z,
		0,
		camera.z - (bounds.max.z + offset.z),
	);
	return Math.hypot(x, y, z);
}
