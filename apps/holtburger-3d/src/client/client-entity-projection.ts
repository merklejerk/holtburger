import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../lib/game/landblocks";
import {
	createPerspectiveMat4,
	createViewMat4,
	multiplyMat4,
} from "../lib/game/math/matrices";
import type { AABB3, Mat4 } from "../lib/game/math/types";
import { Vec3 } from "../lib/game/math/types";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ResolvedScenePlacement } from "../lib/game/scene";

/** Homogeneous clip coordinates before perspective division. */
export interface ClientEntityClipPoint {
	/** Perspective divisor; positive values lie in front of the camera. */
	readonly w: number;
	/** Horizontal homogeneous clip coordinate. */
	readonly x: number;
	/** Vertical homogeneous clip coordinate. */
	readonly y: number;
	/** Depth homogeneous clip coordinate. */
	readonly z: number;
}

/** Canvas-local CSS coordinates of an entity indicator. */
export interface ClientEntityScreenPoint {
	/** Horizontal distance from the canvas left edge, in CSS pixels. */
	readonly x: number;
	/** Vertical distance from the canvas top edge, in CSS pixels. */
	readonly y: number;
}

/** Placement and viewport facts sampled from the current presentation. */
export interface ClientEntityProjectionInput {
	/** Current rigid bounds in entity-local coordinates. */
	readonly bounds: AABB3;
	/** Flattened entity placement, including animated attachment ancestry. */
	readonly placement: ResolvedScenePlacement;
	/** Camera and render extent used by the last presented primary view. */
	readonly view: PrimaryCameraView;
	/** Canvas width in CSS pixels, independent of render scale. */
	readonly cssWidth: number;
	/** Canvas height in CSS pixels, independent of render scale. */
	readonly cssHeight: number;
}

/** Build the camera and landblock transform once for all points in one entity bound. */
export function createClientEntityProjector(
	view: PrimaryCameraView,
	placement: ResolvedScenePlacement,
): (x: number, y: number, z: number) => ClientEntityClipPoint {
	const { camera, extent } = view;
	const anchorLandblockId = camera.placement.landblockId;
	const anchorOrigin = createLandblockWorldOrigin(anchorLandblockId);
	const cameraPosition = new Vec3(
		camera.placement.position.x - anchorOrigin.x,
		camera.placement.position.y,
		camera.placement.position.z - anchorOrigin.z,
	);
	const clipFromAnchor = multiplyMat4(
		createPerspectiveMat4(
			camera.fov,
			extent.width / extent.height,
			camera.near,
			camera.far,
		),
		createViewMat4(cameraPosition, camera.placement.rotation),
	);
	const landblockOffset = createLandblockOffset(
		getLandblockCoordinates(placement.landblockId),
		getLandblockCoordinates(anchorLandblockId),
	);
	return (x, y, z) =>
		projectLocalPoint(
			placement.localToLandblock,
			clipFromAnchor,
			landblockOffset,
			x,
			y,
			z,
		);
}

/** Project the bounds center; walls do not participate in UI indicator visibility. */
export function projectClientEntityCenter(
	input: ClientEntityProjectionInput,
): ClientEntityScreenPoint | null {
	const { bounds, cssWidth, cssHeight } = input;
	if (cssWidth <= 0 || cssHeight <= 0) return null;
	const point = createClientEntityProjector(input.view, input.placement)(
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	);
	if (
		![point.x, point.y, point.z, point.w].every(Number.isFinite) ||
		point.w <= 0 ||
		Math.abs(point.x) > point.w ||
		Math.abs(point.y) > point.w ||
		Math.abs(point.z) > point.w
	)
		return null;
	return {
		x: ((point.x / point.w + 1) * cssWidth) / 2,
		y: ((1 - point.y / point.w) * cssHeight) / 2,
	};
}

function projectLocalPoint(
	localToLandblock: Mat4,
	clipFromAnchor: Mat4,
	landblockOffset: Vec3,
	x: number,
	y: number,
	z: number,
): ClientEntityClipPoint {
	const anchorX =
		localToLandblock.m11 * x +
		localToLandblock.m21 * y +
		localToLandblock.m31 * z +
		localToLandblock.m41 +
		landblockOffset.x;
	const anchorY =
		localToLandblock.m12 * x +
		localToLandblock.m22 * y +
		localToLandblock.m32 * z +
		localToLandblock.m42 +
		landblockOffset.y;
	const anchorZ =
		localToLandblock.m13 * x +
		localToLandblock.m23 * y +
		localToLandblock.m33 * z +
		localToLandblock.m43 +
		landblockOffset.z;
	return {
		w:
			clipFromAnchor.m14 * anchorX +
			clipFromAnchor.m24 * anchorY +
			clipFromAnchor.m34 * anchorZ +
			clipFromAnchor.m44,
		x:
			clipFromAnchor.m11 * anchorX +
			clipFromAnchor.m21 * anchorY +
			clipFromAnchor.m31 * anchorZ +
			clipFromAnchor.m41,
		y:
			clipFromAnchor.m12 * anchorX +
			clipFromAnchor.m22 * anchorY +
			clipFromAnchor.m32 * anchorZ +
			clipFromAnchor.m42,
		z:
			clipFromAnchor.m13 * anchorX +
			clipFromAnchor.m23 * anchorY +
			clipFromAnchor.m33 * anchorZ +
			clipFromAnchor.m43,
	};
}
