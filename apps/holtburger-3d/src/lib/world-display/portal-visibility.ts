import {
	Box3,
	Frustum,
	Matrix4,
	PerspectiveCamera,
	Vector2,
	Vector3,
	Vector4,
} from "three";

import type { Vec3Dto } from "../host/contracts";
import type {
	PortalAperturePlane,
	PortalApertureVisibleSide,
} from "./portal-apertures";

export interface PortalVisibilityInput {
	worldPoints: readonly Vec3Dto[];
	worldPlane: PortalAperturePlane | null;
	visibleSide: PortalApertureVisibleSide;
	context: PortalVisibilityContext;
}

export interface PortalVisibilityResult {
	visible: boolean;
	reason:
		| "visible"
		| "missing-points"
		| "outside-frustum"
		| "back-facing"
		| "too-small";
	screenAreaPx: number;
}

export interface PortalVisibilityContext {
	camera: PerspectiveCamera;
	cameraPosition: Vector3;
	frustum: Frustum;
	projectionScreenMatrix: Matrix4;
	viewport: Vector2;
	minScreenAreaRatio: number;
	minScreenAreaPx: number;
}

type ClipPlane = "left" | "right" | "bottom" | "top" | "near" | "far";

const CLIP_PLANES: readonly ClipPlane[] = [
	"left",
	"right",
	"bottom",
	"top",
	"near",
	"far",
];

export function createPortalVisibilityContext({
	camera,
	viewport,
	minScreenAreaRatio,
}: {
	camera: PerspectiveCamera;
	viewport: Vector2;
	minScreenAreaRatio: number;
}): PortalVisibilityContext {
	camera.updateMatrixWorld();
	const projectionScreenMatrix = new Matrix4().multiplyMatrices(
		camera.projectionMatrix,
		camera.matrixWorldInverse,
	);
	const cameraPosition = new Vector3();
	camera.getWorldPosition(cameraPosition);
	return {
		camera,
		cameraPosition,
		frustum: new Frustum().setFromProjectionMatrix(projectionScreenMatrix),
		projectionScreenMatrix,
		viewport,
		minScreenAreaRatio,
		minScreenAreaPx: viewport.x * viewport.y * minScreenAreaRatio,
	};
}

export function evaluatePortalVisibility({
	worldPoints,
	worldPlane,
	visibleSide,
	context,
}: PortalVisibilityInput): PortalVisibilityResult {
	if (worldPoints.length < 3) {
		return { visible: false, reason: "missing-points", screenAreaPx: 0 };
	}

	const vectors = worldPoints.map(toVector3);
	if (!context.frustum.intersectsBox(new Box3().setFromPoints(vectors))) {
		return { visible: false, reason: "outside-frustum", screenAreaPx: 0 };
	}

	if (
		!worldPlane ||
		!isCameraOnPortalVisibleSide(worldPlane, visibleSide, context)
	) {
		return { visible: false, reason: "back-facing", screenAreaPx: 0 };
	}

	const screenAreaPx = calculateClippedProjectedAreaPx(
		vectors,
		context.projectionScreenMatrix,
		context.viewport,
	);
	if (screenAreaPx < context.minScreenAreaPx) {
		return { visible: false, reason: "too-small", screenAreaPx };
	}

	return { visible: true, reason: "visible", screenAreaPx };
}

function isCameraOnPortalVisibleSide(
	plane: PortalAperturePlane,
	visibleSide: PortalApertureVisibleSide,
	context: PortalVisibilityContext,
): boolean {
	const normal = toVector3(plane.normal).normalize();
	if (normal.lengthSq() === 0) {
		return false;
	}

	const signedDistance = normal.dot(context.cameraPosition) - plane.constant;
	return visibleSide === "positive" ? signedDistance > 0 : signedDistance < 0;
}

export function calculateClippedProjectedAreaPx(
	points: readonly Vector3[],
	projectionScreenMatrix: Matrix4,
	viewport: Vector2,
): number {
	const clipped = CLIP_PLANES.reduce<Vector4[]>(
		(polygon, plane) => clipPolygonToPlane(polygon, plane),
		points.map((point) =>
			new Vector4(point.x, point.y, point.z, 1).applyMatrix4(
				projectionScreenMatrix,
			),
		),
	);
	if (clipped.length < 3) {
		return 0;
	}

	const screenPoints = clipped.map((point) => {
		const inverseW = 1 / point.w;
		return {
			x: ((point.x * inverseW + 1) / 2) * viewport.x,
			y: ((1 - point.y * inverseW) / 2) * viewport.y,
		};
	});
	return calculatePolygonArea(screenPoints);
}

function clipPolygonToPlane(
	points: readonly Vector4[],
	plane: ClipPlane,
): Vector4[] {
	const output: Vector4[] = [];
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const previous = points[(index + points.length - 1) % points.length];
		if (!current || !previous) {
			continue;
		}

		const currentInside = signedClipDistance(current, plane) >= 0;
		const previousInside = signedClipDistance(previous, plane) >= 0;
		if (currentInside !== previousInside) {
			output.push(intersectClipEdge(previous, current, plane));
		}
		if (currentInside) {
			output.push(current.clone());
		}
	}
	return output;
}

function intersectClipEdge(
	start: Vector4,
	end: Vector4,
	plane: ClipPlane,
): Vector4 {
	const startDistance = signedClipDistance(start, plane);
	const endDistance = signedClipDistance(end, plane);
	const denominator = startDistance - endDistance;
	if (denominator === 0) {
		return end.clone();
	}

	const t = startDistance / denominator;
	return start.clone().lerp(end, t);
}

function signedClipDistance(point: Vector4, plane: ClipPlane): number {
	switch (plane) {
		case "left":
			return point.x + point.w;
		case "right":
			return point.w - point.x;
		case "bottom":
			return point.y + point.w;
		case "top":
			return point.w - point.y;
		case "near":
			return point.z + point.w;
		case "far":
			return point.w - point.z;
	}
}

function calculatePolygonArea(
	points: readonly { x: number; y: number }[],
): number {
	let area = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		if (!current || !next) {
			continue;
		}
		area += current.x * next.y - next.x * current.y;
	}
	return Math.abs(area) / 2;
}

function toVector3(point: Vec3Dto): Vector3 {
	return new Vector3(point.x, point.y, point.z);
}
