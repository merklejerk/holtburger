import {
	acVector3,
	acVectorToRender,
	renderVector,
	sceneVec3,
	type AcVector3,
	type SceneVec3,
} from "../../lib/assets/ac-frame";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";
import { rotateRenderVector } from "../../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../../lib/game/math/types";
import {
	crossVec3,
	dotVec3,
	normalizeVec3,
	scaleVec3,
} from "../../lib/game/math/vector-utils";
import {
	TRANSFORM_GIZMO_GEOMETRY,
	type TransformGizmoAxis,
	type TransformGizmoHandle,
} from "../../lib/game/renderer/overlays/transform-gizmo-contract";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type { PresentedSelectionRay } from "../../lib/game/selection/entity-selection-intersection";
import type { ExplorerWorldPose } from "../entities/entity-commands";
import { EXPLORER_TUNING } from "../explorer-tuning";
import type { ExplorerTuning } from "../explorer-tuning-contract";

/** Client-space viewport rectangle used by gizmo projection and hit-testing. */
export interface GizmoCanvasBounds {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** Active translation drag baseline captured at pointer-down. */
interface GizmoTranslationDragState {
	readonly kind: "translate";
	readonly axis: TransformGizmoAxis;
	readonly startPose: ExplorerWorldPose;
	readonly originRender: SceneVec3;
	readonly startParam: number;
	readonly cameraFallbackNormal: Vec3;
}

/** Active rotation drag baseline captured at pointer-down. */
interface GizmoRotationDragState {
	readonly kind: "rotate";
	readonly axis: TransformGizmoAxis;
	readonly startPose: ExplorerWorldPose;
	readonly originRender: SceneVec3;
	readonly mode:
		| {
				readonly kind: "plane";
				readonly startDirection: Vec3;
		  }
		| {
				readonly kind: "screen-tangent";
				readonly startClientX: number;
				readonly startClientY: number;
				readonly tangentScreenX: number;
				readonly tangentScreenY: number;
				readonly radiansPerPixel: number;
		  };
}

export type GizmoDragState = GizmoTranslationDragState | GizmoRotationDragState;

const AXES: readonly TransformGizmoAxis[] = ["x", "y", "z"];
const CONE_HIT_BONUS_PIXELS = 3;
const BACK_RING_PENALTY_PIXELS = 4;
const GRAZING_AXIS_DOT_LIMIT = 0.985;
const EDGE_ON_PLANE_DOT_LIMIT = 0.15;

const AC_AXES: Readonly<Record<TransformGizmoAxis, AcVector3>> = {
	x: acVector3([1, 0, 0]),
	y: acVector3([0, 1, 0]),
	z: acVector3([0, 0, 1]),
};

/** Precomputed WebGL Y-up render directions for AC +X (East), +Y (North), +Z (Up). */
const RENDER_AXES: Readonly<Record<TransformGizmoAxis, Vec3>> = {
	x: cleanZeroVec3(renderVector(1, 0, 0)),
	y: cleanZeroVec3(renderVector(0, 1, 0)),
	z: cleanZeroVec3(renderVector(0, 0, 1)),
};

function cleanZeroVec3(v: Vec3): Vec3 {
	return new Vec3(v.x || 0, v.y || 0, v.z || 0);
}

/** Unit direction of one AC world axis (+X East, +Y North, +Z Up). */
export function acAxisVector(axis: TransformGizmoAxis): AcVector3 {
	return AC_AXES[axis];
}

/** Unit direction of one AC world axis expressed in WebGL Y-up render space. */
export function renderAxisVector(axis: TransformGizmoAxis): Vec3 {
	return RENDER_AXES[axis];
}

/** Orthogonal tangent pair spanning the plane perpendicular to one render-space axis. */
function renderAxisPlaneBasis(axis: TransformGizmoAxis): {
	readonly u: Vec3;
	readonly v: Vec3;
} {
	if (axis === "x") {
		return { u: RENDER_AXES.y, v: RENDER_AXES.z };
	}
	if (axis === "y") {
		return { u: RENDER_AXES.z, v: RENDER_AXES.x };
	}
	return { u: RENDER_AXES.x, v: RENDER_AXES.y };
}

/** Convert an AC world position into a global render-space `SceneVec3`. */
export function worldPoseToSceneVec3(pose: ExplorerWorldPose): SceneVec3 {
	const origin = createLandblockWorldOrigin(pose.landblockId);
	const localRender = acVectorToRender(
		acVector3([pose.coords.x, pose.coords.y, pose.coords.z]),
	);
	return sceneVec3(
		new Vec3(
			origin.x + localRender[0],
			origin.y + localRender[1],
			origin.z + localRender[2],
		),
	);
}

/** Compute constant-screen-size uniform world scale from camera distance and vertical FOV. */
export function computeGizmoScale(
	cameraPosition: Vec3,
	gizmoOrigin: Vec3,
	verticalFovDegrees: number,
	tuning: Pick<
		ExplorerTuning["gizmo"],
		"screenHeightFraction" | "minScaleMeters" | "maxScaleMeters"
	> = EXPLORER_TUNING.gizmo,
): number {
	const distance = Math.sqrt(cameraPosition.distanceSquaredTo(gizmoOrigin));
	if (!Number.isFinite(distance) || distance <= 0) {
		return tuning.minScaleMeters;
	}
	const halfHeight = distance * Math.tan((verticalFovDegrees * Math.PI) / 360);
	const raw = halfHeight * tuning.screenHeightFraction;
	return Math.min(tuning.maxScaleMeters, Math.max(tuning.minScaleMeters, raw));
}

/** Project one render-space world point into client CSS pixels using the exact primary camera view. */
export function projectRenderPointToClient(
	point: Vec3,
	view: PrimaryCameraView,
	bounds: GizmoCanvasBounds,
): { readonly x: number; readonly y: number; readonly depth: number } | null {
	if (
		bounds.width <= 0 ||
		bounds.height <= 0 ||
		view.extent.width <= 0 ||
		view.extent.height <= 0
	) {
		return null;
	}
	const offset = new Vec3(
		point.x - view.camera.placement.position.x,
		point.y - view.camera.placement.position.y,
		point.z - view.camera.placement.position.z,
	);
	const invRot = conjugateQuat(view.camera.placement.rotation);
	const local = rotateRenderVector(offset, invRot);
	const depth = -local.z;
	if (!Number.isFinite(depth) || depth <= view.camera.near * 0.1) return null;
	const tangent = Math.tan((view.camera.fov * Math.PI) / 360);
	const aspect = view.extent.width / view.extent.height;
	const ndcX = local.x / (depth * tangent * aspect);
	const ndcY = local.y / (depth * tangent);
	if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
	return {
		x: bounds.left + (ndcX + 1) * 0.5 * bounds.width,
		y: bounds.top + (1 - ndcY) * 0.5 * bounds.height,
		depth,
	};
}

/** Pick the closest translate or rotate handle under `(clientX, clientY)` in screen space. */
export function pickTransformGizmoHandle(
	view: PrimaryCameraView,
	bounds: GizmoCanvasBounds,
	origin: Vec3,
	scale: number,
	clientX: number,
	clientY: number,
	hitTolerancePixels: number = EXPLORER_TUNING.gizmo.hitTolerancePixels,
): TransformGizmoHandle | null {
	if (!Number.isFinite(scale) || scale <= 0) return null;
	const toCamera = safeNormalizeDirection(
		view.camera.placement.position.x - origin.x,
		view.camera.placement.position.y - origin.y,
		view.camera.placement.position.z - origin.z,
	);
	if (toCamera === null) return null;

	let bestHandle: TransformGizmoHandle | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	// 1. Test translate shafts and cones (cones get a small priority bonus on ties).
	for (const axis of AXES) {
		const dir = RENDER_AXES[axis];
		const shaftStart = origin.add(
			scaleVec3(dir, TRANSFORM_GIZMO_GEOMETRY.shaftStart * scale),
		);
		const shaftEnd = origin.add(
			scaleVec3(dir, TRANSFORM_GIZMO_GEOMETRY.shaftEnd * scale),
		);
		const coneEnd = origin.add(
			scaleVec3(dir, TRANSFORM_GIZMO_GEOMETRY.coneEnd * scale),
		);

		const pStart = projectRenderPointToClient(shaftStart, view, bounds);
		const pMid = projectRenderPointToClient(shaftEnd, view, bounds);
		const pEnd = projectRenderPointToClient(coneEnd, view, bounds);

		if (pStart !== null && pMid !== null) {
			const dist = pointToSegmentDistance2D(
				clientX,
				clientY,
				pStart.x,
				pStart.y,
				pMid.x,
				pMid.y,
			);
			if (dist <= hitTolerancePixels && dist < bestScore) {
				bestScore = dist;
				bestHandle = { kind: "translate", axis };
			}
		}
		if (pMid !== null && pEnd !== null) {
			const dist = pointToSegmentDistance2D(
				clientX,
				clientY,
				pMid.x,
				pMid.y,
				pEnd.x,
				pEnd.y,
			);
			const scored = Math.max(0, dist - CONE_HIT_BONUS_PIXELS);
			if (dist <= hitTolerancePixels && scored < bestScore) {
				bestScore = scored;
				bestHandle = { kind: "translate", axis };
			}
		}
	}

	// 2. Test rotation rings (front-facing hemisphere preferred over dimmed back hemisphere).
	const segments = TRANSFORM_GIZMO_GEOMETRY.ringSegments;
	const ringRadius = TRANSFORM_GIZMO_GEOMETRY.ringRadius * scale;
	for (const axis of AXES) {
		const { u, v } = renderAxisPlaneBasis(axis);
		let prevPoint: {
			readonly x: number;
			readonly y: number;
			readonly front: boolean;
		} | null = null;
		for (let i = 0; i <= segments; i++) {
			const theta = (i / segments) * Math.PI * 2;
			const cos = Math.cos(theta);
			const sin = Math.sin(theta);
			const localOffset = scaleVec3(u, cos * ringRadius).add(
				scaleVec3(v, sin * ringRadius),
			);
			const worldPoint = origin.add(localOffset);
			const projected = projectRenderPointToClient(worldPoint, view, bounds);
			const front = dotVec3(localOffset, toCamera) >= -0.05 * ringRadius;
			const current =
				projected === null ? null : { x: projected.x, y: projected.y, front };
			if (prevPoint !== null && current !== null) {
				const dist = pointToSegmentDistance2D(
					clientX,
					clientY,
					prevPoint.x,
					prevPoint.y,
					current.x,
					current.y,
				);
				const frontSegment = prevPoint.front || current.front;
				const scored = frontSegment ? dist : dist + BACK_RING_PENALTY_PIXELS;
				if (dist <= hitTolerancePixels && scored < bestScore) {
					bestScore = scored;
					bestHandle = { kind: "rotate", axis };
				}
			}
			prevPoint = current;
		}
	}

	return bestHandle;
}

/** Capture immutable baseline state when beginning a gizmo drag on a hit handle. */
export function beginGizmoDrag(
	handle: TransformGizmoHandle,
	startPose: ExplorerWorldPose,
	originRender: SceneVec3,
	ray: PresentedSelectionRay,
	view: PrimaryCameraView,
	bounds: GizmoCanvasBounds,
	clientX: number,
	clientY: number,
	scale: number,
): GizmoDragState | null {
	const rayDir = safeNormalizeDirection(
		ray.direction.x,
		ray.direction.y,
		ray.direction.z,
	);
	if (rayDir === null) return null;

	if (handle.kind === "translate") {
		const axisRender = RENDER_AXES[handle.axis];
		const fallbackNormal = computeTranslationFallbackNormal(axisRender, rayDir);
		const startParam = resolveAxisTranslationParam(
			originRender,
			axisRender,
			ray.start,
			rayDir,
			fallbackNormal,
		);
		if (startParam === null) return null;
		return {
			kind: "translate",
			axis: handle.axis,
			startPose,
			originRender,
			startParam,
			cameraFallbackNormal: fallbackNormal,
		};
	}

	const axisRender = RENDER_AXES[handle.axis];
	const planeHit =
		Math.abs(dotVec3(rayDir, axisRender)) >= EDGE_ON_PLANE_DOT_LIMIT
			? intersectRayPlane(ray.start, rayDir, originRender, axisRender)
			: null;
	if (planeHit !== null) {
		const startDirection = safeNormalizeDirection(
			planeHit.x - originRender.x,
			planeHit.y - originRender.y,
			planeHit.z - originRender.z,
		);
		if (startDirection !== null) {
			return {
				kind: "rotate",
				axis: handle.axis,
				startPose,
				originRender,
				mode: {
					kind: "plane",
					startDirection,
				},
			};
		}
	}

	// Edge-on fallback: project the tangent of a reference ring point onto screen pixels.
	const ringRadius = TRANSFORM_GIZMO_GEOMETRY.ringRadius * scale;
	const toCamera =
		safeNormalizeDirection(
			view.camera.placement.position.x - originRender.x,
			view.camera.placement.position.y - originRender.y,
			view.camera.placement.position.z - originRender.z,
		) ?? new Vec3(0, 0, 1);
	const radial = projectOntoPlane(toCamera, axisRender);
	const grabUnit =
		safeNormalizeDirection(radial.x, radial.y, radial.z) ??
		renderAxisPlaneBasis(handle.axis).u;
	// Positive right-hand rotation around `axisRender` moves `grabUnit` along `cross(axisRender, grabUnit)`.
	const worldTangent = normalizeVec3(crossVec3(axisRender, grabUnit));
	const p0 = projectRenderPointToClient(
		originRender.add(scaleVec3(grabUnit, ringRadius)),
		view,
		bounds,
	);
	const p1 = projectRenderPointToClient(
		originRender
			.add(scaleVec3(grabUnit, ringRadius))
			.add(scaleVec3(worldTangent, ringRadius * 0.25)),
		view,
		bounds,
	);
	let tangentScreenX = 1;
	let tangentScreenY = 0;
	if (p0 !== null && p1 !== null) {
		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const len = Math.hypot(dx, dy);
		if (len > 1e-3) {
			tangentScreenX = dx / len;
			tangentScreenY = dy / len;
		}
	}
	return {
		kind: "rotate",
		axis: handle.axis,
		startPose,
		originRender,
		mode: {
			kind: "screen-tangent",
			startClientX: clientX,
			startClientY: clientY,
			tangentScreenX,
			tangentScreenY,
			radiansPerPixel: Math.PI / 180,
		},
	};
}

/**
 * Solve the updated AC `WorldPosition` for one gizmo drag step from the immutable start state.
 *
 * Returns `null` when the cursor ray misses the drag axis/plane or lands behind the camera so the
 * caller holds the prior preview pose cleanly instead of snapping back to `startPose`.
 */
export function solveGizmoDragPose(
	drag: GizmoDragState,
	ray: PresentedSelectionRay,
	clientX: number,
	clientY: number,
	snap: boolean,
	tuning: Pick<
		ExplorerTuning["gizmo"],
		"translateSnapMeters" | "rotateSnapDegrees" | "maxTranslateDistanceMeters"
	> = EXPLORER_TUNING.gizmo,
): ExplorerWorldPose | null {
	const rayDir = safeNormalizeDirection(
		ray.direction.x,
		ray.direction.y,
		ray.direction.z,
	);
	if (rayDir === null) return null;

	if (drag.kind === "translate") {
		const axisRender = RENDER_AXES[drag.axis];
		const param = resolveAxisTranslationParam(
			drag.originRender,
			axisRender,
			ray.start,
			rayDir,
			drag.cameraFallbackNormal,
		);
		if (param === null) return null;
		let delta = param - drag.startParam;
		if (snap && tuning.translateSnapMeters > 0) {
			delta =
				Math.round(delta / tuning.translateSnapMeters) *
				tuning.translateSnapMeters;
		}
		delta = Math.max(
			-tuning.maxTranslateDistanceMeters,
			Math.min(tuning.maxTranslateDistanceMeters, delta),
		);
		const acAxis = AC_AXES[drag.axis];
		return {
			landblockId: drag.startPose.landblockId,
			coords: {
				x: drag.startPose.coords.x + acAxis[0] * delta,
				y: drag.startPose.coords.y + acAxis[1] * delta,
				z: drag.startPose.coords.z + acAxis[2] * delta,
			},
			rotation: drag.startPose.rotation,
		};
	}

	const axisRender = RENDER_AXES[drag.axis];
	let deltaRadians: number;
	if (drag.mode.kind === "plane") {
		const hit = intersectRayPlane(
			ray.start,
			rayDir,
			drag.originRender,
			axisRender,
		);
		if (hit === null) return null;
		const currentDir = safeNormalizeDirection(
			hit.x - drag.originRender.x,
			hit.y - drag.originRender.y,
			hit.z - drag.originRender.z,
		);
		if (currentDir === null) return null;
		const sinTerm = dotVec3(
			axisRender,
			crossVec3(drag.mode.startDirection, currentDir),
		);
		const cosTerm = dotVec3(drag.mode.startDirection, currentDir);
		deltaRadians = Math.atan2(sinTerm, cosTerm);
	} else {
		const dx = clientX - drag.mode.startClientX;
		const dy = clientY - drag.mode.startClientY;
		const projectedPixels =
			dx * drag.mode.tangentScreenX + dy * drag.mode.tangentScreenY;
		deltaRadians = projectedPixels * drag.mode.radiansPerPixel;
	}

	if (snap && tuning.rotateSnapDegrees > 0) {
		const stepRadians = (tuning.rotateSnapDegrees * Math.PI) / 180;
		deltaRadians = Math.round(deltaRadians / stepRadians) * stepRadians;
	}

	const acAxis = AC_AXES[drag.axis];
	const half = deltaRadians * 0.5;
	const sinHalf = Math.sin(half);
	const deltaQuat = {
		w: Math.cos(half),
		x: acAxis[0] * sinHalf,
		y: acAxis[1] * sinHalf,
		z: acAxis[2] * sinHalf,
	};
	return {
		landblockId: drag.startPose.landblockId,
		coords: drag.startPose.coords,
		rotation: normalizeAcQuat(
			multiplyAcQuat(deltaQuat, drag.startPose.rotation),
		),
	};
}

function resolveAxisTranslationParam(
	origin: Vec3,
	axis: Vec3,
	rayStart: Vec3,
	rayDir: Vec3,
	fallbackNormal: Vec3,
): number | null {
	const dot = dotVec3(axis, rayDir);
	if (Math.abs(dot) < GRAZING_AXIS_DOT_LIMIT) {
		// Closest point on line (origin + t * axis) to ray (rayStart + s * rayDir), requiring s > 0
		// so sweeping past the axis vanishing point cannot flip behind the camera.
		const w0 = new Vec3(
			origin.x - rayStart.x,
			origin.y - rayStart.y,
			origin.z - rayStart.z,
		);
		const d = dotVec3(axis, w0);
		const e = dotVec3(rayDir, w0);
		const denom = 1 - dot * dot;
		if (denom > 1e-6) {
			const s = (e - dot * d) / denom;
			if (!Number.isFinite(s) || s <= 0) return null;
			const t = (dot * e - d) / denom;
			return Number.isFinite(t) ? t : null;
		}
	}
	const hit = intersectRayPlane(rayStart, rayDir, origin, fallbackNormal);
	if (hit === null) return null;
	const offset = new Vec3(hit.x - origin.x, hit.y - origin.y, hit.z - origin.z);
	const t = dotVec3(offset, axis);
	return Number.isFinite(t) ? t : null;
}

function computeTranslationFallbackNormal(
	axis: Vec3,
	cameraForward: Vec3,
): Vec3 {
	const side = crossVec3(axis, cameraForward);
	const sideLen = Math.hypot(side.x, side.y, side.z);
	if (sideLen > 1e-4) {
		return normalizeVec3(crossVec3(side, axis));
	}
	return cameraForward;
}

function intersectRayPlane(
	rayStart: Vec3,
	rayDir: Vec3,
	planePoint: Vec3,
	planeNormal: Vec3,
): Vec3 | null {
	const denom = dotVec3(rayDir, planeNormal);
	if (Math.abs(denom) < 1e-5) return null;
	const diff = new Vec3(
		planePoint.x - rayStart.x,
		planePoint.y - rayStart.y,
		planePoint.z - rayStart.z,
	);
	const t = dotVec3(diff, planeNormal) / denom;
	if (!Number.isFinite(t) || t < 0) return null;
	return rayStart.add(scaleVec3(rayDir, t));
}

function projectOntoPlane(vector: Vec3, normal: Vec3): Vec3 {
	const projection = dotVec3(vector, normal);
	return new Vec3(
		vector.x - normal.x * projection,
		vector.y - normal.y * projection,
		vector.z - normal.z * projection,
	);
}

function safeNormalizeDirection(x: number, y: number, z: number): Vec3 | null {
	const len = Math.hypot(x, y, z);
	if (!Number.isFinite(len) || len <= 1e-5) return null;
	return new Vec3(x / len, y / len, z / len);
}

function conjugateQuat(q: Quat): Quat {
	return new Quat(q.w, -q.x, -q.y, -q.z);
}

function multiplyAcQuat(
	a: ExplorerWorldPose["rotation"],
	b: ExplorerWorldPose["rotation"],
): ExplorerWorldPose["rotation"] {
	return {
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
	};
}

function normalizeAcQuat(
	q: ExplorerWorldPose["rotation"],
): ExplorerWorldPose["rotation"] {
	const norm = Math.hypot(q.w, q.x, q.y, q.z);
	if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
		return { w: 1, x: 0, y: 0, z: 0 };
	}
	return {
		w: q.w / norm,
		x: q.x / norm,
		y: q.y / norm,
		z: q.z / norm,
	};
}

function pointToSegmentDistance2D(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const abx = bx - ax;
	const aby = by - ay;
	const lenSq = abx * abx + aby * aby;
	if (lenSq <= 1e-8) return Math.hypot(px - ax, py - ay);
	const t = Math.max(
		0,
		Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq),
	);
	return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
