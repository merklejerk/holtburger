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

const CLIP_EPSILON = 1e-7;

/** Geometry policy needed to classify and place the app-local target marker. */
export interface ClientTargetIndicatorGeometryTuning {
	readonly safeInsetCssPixels: number;
}

/** Frame-current offscreen marker placement in canvas-local CSS pixels. */
export interface ClientTargetIndicatorFrame {
	readonly rotationRadians: number;
	readonly x: number;
	readonly y: number;
}

export interface ClientTargetIndicatorProjectionInput {
	readonly bounds: AABB3;
	readonly cssHeight: number;
	readonly cssWidth: number;
	readonly placement: ResolvedScenePlacement;
	readonly tuning: ClientTargetIndicatorGeometryTuning;
	readonly view: PrimaryCameraView;
}

interface ClipPoint {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** Project one exact current rigid bound into an offscreen edge marker, or null while on-screen. */
export function projectClientTargetIndicator(
	input: ClientTargetIndicatorProjectionInput,
): ClientTargetIndicatorFrame | null {
	validateInput(input);
	const { camera, extent } = input.view;
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
		getLandblockCoordinates(input.placement.landblockId),
		getLandblockCoordinates(anchorLandblockId),
	);
	return classifyProjectedBounds(input, clipFromAnchor, landblockOffset);
}

function classifyProjectedBounds(
	input: ClientTargetIndicatorProjectionInput,
	clipFromAnchor: Mat4,
	landblockOffset: Vec3,
): ClientTargetIndicatorFrame | null {
	let allOutsideLeft = true;
	let allOutsideRight = true;
	let allOutsideBottom = true;
	let allOutsideTop = true;
	let allOutsideNear = true;
	let allOutsideFar = true;

	for (let corner = 0; corner < 8; corner += 1) {
		const point = projectLocalPoint(
			input.placement.localToLandblock,
			clipFromAnchor,
			landblockOffset,
			(corner & 1) === 0 ? input.bounds.min.x : input.bounds.max.x,
			(corner & 2) === 0 ? input.bounds.min.y : input.bounds.max.y,
			(corner & 4) === 0 ? input.bounds.min.z : input.bounds.max.z,
		);
		if (![point.x, point.y, point.z, point.w].every(Number.isFinite)) {
			return null;
		}
		allOutsideLeft &&= point.x < -point.w;
		allOutsideRight &&= point.x > point.w;
		allOutsideBottom &&= point.y < -point.w;
		allOutsideTop &&= point.y > point.w;
		allOutsideNear &&= point.z < -point.w;
		allOutsideFar &&= point.z > point.w;
	}

	const outside =
		allOutsideLeft ||
		allOutsideRight ||
		allOutsideBottom ||
		allOutsideTop ||
		allOutsideNear ||
		allOutsideFar;
	if (outside) {
		return edgeIndicator(input, clipFromAnchor, landblockOffset);
	}
	return null;
}

function edgeIndicator(
	input: ClientTargetIndicatorProjectionInput,
	clipFromAnchor: Mat4,
	landblockOffset: Vec3,
): ClientTargetIndicatorFrame {
	const bounds = input.bounds;
	const center = projectLocalPoint(
		input.placement.localToLandblock,
		clipFromAnchor,
		landblockOffset,
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	);
	const directionX = Number.isFinite(center.x) ? center.x : 0;
	let directionY = Number.isFinite(center.y) ? -center.y : 0;
	if (Math.abs(directionX) + Math.abs(directionY) <= CLIP_EPSILON) {
		// Straight behind has no unique screen direction. Choosing down is deterministic and avoids
		// the left/right sign flip caused by dividing through a negative homogeneous W.
		directionY = 1;
	}
	const inset = effectiveInset(input);
	const halfWidth = Math.max(0, input.cssWidth / 2 - inset);
	const halfHeight = Math.max(0, input.cssHeight / 2 - inset);
	const scale = Math.min(
		directionX === 0
			? Number.POSITIVE_INFINITY
			: halfWidth / Math.abs(directionX),
		directionY === 0
			? Number.POSITIVE_INFINITY
			: halfHeight / Math.abs(directionY),
	);
	return {
		rotationRadians: Math.atan2(directionY, directionX) + Math.PI / 2,
		x: input.cssWidth / 2 + directionX * scale,
		y: input.cssHeight / 2 + directionY * scale,
	};
}

function projectLocalPoint(
	localToLandblock: Mat4,
	clipFromAnchor: Mat4,
	landblockOffset: Vec3,
	x: number,
	y: number,
	z: number,
): ClipPoint {
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

function effectiveInset(input: ClientTargetIndicatorProjectionInput): number {
	return Math.min(
		input.tuning.safeInsetCssPixels,
		input.cssWidth / 2,
		input.cssHeight / 2,
	);
}

function validateInput(input: ClientTargetIndicatorProjectionInput): void {
	if (
		!Number.isFinite(input.cssWidth) ||
		input.cssWidth <= 0 ||
		!Number.isFinite(input.cssHeight) ||
		input.cssHeight <= 0 ||
		!Number.isFinite(input.tuning.safeInsetCssPixels) ||
		input.tuning.safeInsetCssPixels < 0
	) {
		throw new Error("Client target-indicator projection input is invalid.");
	}
}
