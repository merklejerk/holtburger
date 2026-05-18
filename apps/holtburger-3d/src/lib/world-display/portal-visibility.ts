import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector2, Vector3 } from "three";

import type { Vec3Dto } from "../host/contracts";
import type {
	PortalAperturePlane,
	PortalApertureVisibleSide,
} from "./portal-apertures";

export interface PortalVisibilityInput {
	worldPoints: readonly Vec3Dto[];
	worldPlane: PortalAperturePlane | null;
	visibleSide: PortalApertureVisibleSide;
	camera: PerspectiveCamera;
	viewport: Vector2;
	minScreenAreaPx: number;
}

export interface PortalVisibilityResult {
	visible: boolean;
	reason: "visible" | "missing-points" | "outside-frustum" | "back-facing" | "too-small";
	screenAreaPx: number;
}

export function evaluatePortalVisibility({
	worldPoints,
	worldPlane,
	visibleSide,
	camera,
	viewport,
	minScreenAreaPx,
}: PortalVisibilityInput): PortalVisibilityResult {
	if (worldPoints.length < 3) {
		return { visible: false, reason: "missing-points", screenAreaPx: 0 };
	}

	const vectors = worldPoints.map(toVector3);
	if (!buildCameraFrustum(camera).intersectsBox(new Box3().setFromPoints(vectors))) {
		return { visible: false, reason: "outside-frustum", screenAreaPx: 0 };
	}

	if (!worldPlane || !isCameraOnPortalVisibleSide(worldPlane, visibleSide, camera)) {
		return { visible: false, reason: "back-facing", screenAreaPx: 0 };
	}

	const screenAreaPx = calculateProjectedBoundingAreaPx(
		vectors,
		camera,
		viewport,
	);
	if (screenAreaPx < minScreenAreaPx) {
		return { visible: false, reason: "too-small", screenAreaPx };
	}

	return { visible: true, reason: "visible", screenAreaPx };
}

function buildCameraFrustum(camera: PerspectiveCamera): Frustum {
	camera.updateMatrixWorld();
	const projectionScreenMatrix = new Matrix4().multiplyMatrices(
		camera.projectionMatrix,
		camera.matrixWorldInverse,
	);
	return new Frustum().setFromProjectionMatrix(projectionScreenMatrix);
}

function isCameraOnPortalVisibleSide(
	plane: PortalAperturePlane,
	visibleSide: PortalApertureVisibleSide,
	camera: PerspectiveCamera,
): boolean {
	const normal = toVector3(plane.normal).normalize();
	if (normal.lengthSq() === 0) {
		return false;
	}

	const cameraPosition = new Vector3();
	camera.getWorldPosition(cameraPosition);
	const signedDistance = normal.dot(cameraPosition) - plane.constant;
	return visibleSide === "positive"
		? signedDistance > 0
		: signedDistance < 0;
}

function calculateProjectedBoundingAreaPx(
	points: readonly Vector3[],
	camera: PerspectiveCamera,
	viewport: Vector2,
): number {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		const projected = point.clone().project(camera);
		const screenX = clamp(
			((projected.x + 1) / 2) * viewport.x,
			0,
			viewport.x,
		);
		const screenY = clamp(
			((1 - projected.y) / 2) * viewport.y,
			0,
			viewport.y,
		);
		minX = Math.min(minX, screenX);
		minY = Math.min(minY, screenY);
		maxX = Math.max(maxX, screenX);
		maxY = Math.max(maxY, screenY);
	}

	return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function toVector3(point: Vec3Dto): Vector3 {
	return new Vector3(point.x, point.y, point.z);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
