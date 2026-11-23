import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../../lib/assets/ac-frame";
import {
	rotateRenderVector,
	tryEntityHorizontalForward,
} from "../../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../../lib/game/math/types";
import { TRANSFORM_GIZMO_GEOMETRY } from "../../lib/game/renderer/overlays/transform-gizmo-contract";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type { ExplorerWorldPose } from "../entities/entity-commands";
import {
	acAxisVector,
	beginGizmoDrag,
	computeGizmoScale,
	pickTransformGizmoHandle,
	projectRenderPointToClient,
	renderAxisVector,
	solveGizmoDragPose,
	worldPoseToSceneVec3,
	type GizmoCanvasBounds,
} from "./transform-gizmo-math";

const BOUNDS: GizmoCanvasBounds = { left: 0, top: 0, width: 1000, height: 800 };

/** Test-owned tuning decoupled from production `EXPLORER_TUNING` edits. */
const TEST_TUNING = {
	screenHeightFraction: 0.2,
	minScaleMeters: 0.5,
	maxScaleMeters: 10,
	hitTolerancePixels: 12,
	translateSnapMeters: 0.25,
	rotateSnapDegrees: 15,
	maxTranslateDistanceMeters: 50,
} as const;

function expectValue<T>(value: T | null | undefined, label: string): T {
	expect(value, label).not.toBeNull();
	expect(value, label).not.toBeUndefined();
	if (value === null || value === undefined) {
		throw new Error(`Expected ${label} to be defined`);
	}
	return value;
}

function makeCameraView(
	position: Vec3,
	rotation: Quat = Quat.identity(),
): PrimaryCameraView {
	return {
		camera: {
			fov: 60,
			near: 0.1,
			far: 1000,
			placement: {
				landblockId: "0x0001ffff",
				envCellId: null,
				position: sceneVec3(position),
				rotation,
			},
		},
		extent: { width: BOUNDS.width, height: BOUNDS.height },
	};
}

function rayAtClient(
	view: PrimaryCameraView,
	clientX: number,
	clientY: number,
) {
	const ndcX = ((clientX - BOUNDS.left) / BOUNDS.width) * 2 - 1;
	const ndcY = 1 - ((clientY - BOUNDS.top) / BOUNDS.height) * 2;
	const tangent = Math.tan((view.camera.fov * Math.PI) / 360);
	const aspect = BOUNDS.width / BOUNDS.height;
	const local = new Vec3(ndcX * tangent * aspect, ndcY * tangent, -1);
	const len = Math.hypot(local.x, local.y, local.z);
	return {
		start: view.camera.placement.position.clone(),
		direction: rotateRenderVector(
			new Vec3(local.x / len, local.y / len, local.z / len),
			view.camera.placement.rotation,
		),
	};
}

describe("transform-gizmo-math", () => {
	it("maps AC world axes into WebGL Y-up render axes cleanly", () => {
		expect(acAxisVector("x")).toEqual([1, 0, 0]);
		expect(acAxisVector("y")).toEqual([0, 1, 0]);
		expect(acAxisVector("z")).toEqual([0, 0, 1]);
		expect(renderAxisVector("x")).toEqual(new Vec3(1, 0, 0));
		// AC +Y (North) maps to render -Z; AC +Z (Up) maps to render +Y.
		expect(renderAxisVector("y")).toEqual(new Vec3(0, 0, -1));
		expect(renderAxisVector("z")).toEqual(new Vec3(0, 1, 0));
	});

	it("scales gizmo proportionally to camera distance within tuned bounds", () => {
		const origin = new Vec3(0, 0, 0);
		expect(
			computeGizmoScale(new Vec3(0, 0, 0.1), origin, 60, TEST_TUNING),
		).toBe(TEST_TUNING.minScaleMeters);
		const near = computeGizmoScale(new Vec3(0, 0, 10), origin, 60, TEST_TUNING);
		const far = computeGizmoScale(new Vec3(0, 0, 20), origin, 60, TEST_TUNING);
		expect(far).toBeCloseTo(near * 2, 5);
		expect(
			computeGizmoScale(new Vec3(0, 0, 5000), origin, 60, TEST_TUNING),
		).toBe(TEST_TUNING.maxScaleMeters);
	});

	it("picks translate arrowheads and rotation rings accurately and survives coincident camera", () => {
		const pose: ExplorerWorldPose = {
			landblockId: 0x0001_ffff,
			coords: { x: 10, y: 20, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		};
		const origin = worldPoseToSceneVec3(pose);
		const view = makeCameraView(
			new Vec3(origin.x, origin.y + 1, origin.z + 10),
		);
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			60,
			TEST_TUNING,
		);

		const xTip = expectValue(
			projectRenderPointToClient(
				new Vec3(
					origin.x + TRANSFORM_GIZMO_GEOMETRY.coneEnd * scale,
					origin.y,
					origin.z,
				),
				view,
				BOUNDS,
			),
			"xTip",
		);
		expect(
			pickTransformGizmoHandle(
				view,
				BOUNDS,
				origin,
				scale,
				xTip.x,
				xTip.y,
				TEST_TUNING.hitTolerancePixels,
			),
		).toEqual({ kind: "translate", axis: "x" });

		const zTip = expectValue(
			projectRenderPointToClient(
				new Vec3(
					origin.x,
					origin.y + TRANSFORM_GIZMO_GEOMETRY.coneEnd * scale,
					origin.z,
				),
				view,
				BOUNDS,
			),
			"zTip",
		);
		expect(
			pickTransformGizmoHandle(
				view,
				BOUNDS,
				origin,
				scale,
				zTip.x,
				zTip.y,
				TEST_TUNING.hitTolerancePixels,
			),
		).toEqual({ kind: "translate", axis: "z" });

		// Pick the Y rotation ring (lies in AC XZ plane => render XY plane, facing camera).
		const ringAngle = Math.PI / 4;
		const r = TRANSFORM_GIZMO_GEOMETRY.ringRadius * scale;
		const yRingPoint = expectValue(
			projectRenderPointToClient(
				new Vec3(
					origin.x + Math.cos(ringAngle) * r,
					origin.y + Math.sin(ringAngle) * r,
					origin.z,
				),
				view,
				BOUNDS,
			),
			"yRingPoint",
		);
		expect(
			pickTransformGizmoHandle(
				view,
				BOUNDS,
				origin,
				scale,
				yRingPoint.x,
				yRingPoint.y,
				TEST_TUNING.hitTolerancePixels,
			),
		).toEqual({ kind: "rotate", axis: "y" });

		// Far corner misses the gizmo cleanly.
		expect(
			pickTransformGizmoHandle(
				view,
				BOUNDS,
				origin,
				scale,
				10,
				10,
				TEST_TUNING.hitTolerancePixels,
			),
		).toBeNull();

		// Coincident camera and gizmo origin returns null without throwing.
		const coincidentView = makeCameraView(origin.clone());
		expect(
			pickTransformGizmoHandle(
				coincidentView,
				BOUNDS,
				origin,
				scale,
				BOUNDS.width / 2,
				BOUNDS.height / 2,
				TEST_TUNING.hitTolerancePixels,
			),
		).toBeNull();
	});

	it("translates along AC X, Y, and Z axes accurately and honors Shift snapping and distance clamping", () => {
		const pose: ExplorerWorldPose = {
			landblockId: 0x0001_ffff,
			coords: { x: 10, y: 20, z: 5 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		};
		const origin = worldPoseToSceneVec3(pose);
		const view = makeCameraView(new Vec3(origin.x, origin.y, origin.z + 10));
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			60,
			TEST_TUNING,
		);

		const startPt = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x + 1, origin.y, origin.z),
				view,
				BOUNDS,
			),
			"x startPt",
		);
		const endPt = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x + 3.12, origin.y, origin.z),
				view,
				BOUNDS,
			),
			"x endPt",
		);
		const dragX = expectValue(
			beginGizmoDrag(
				{ kind: "translate", axis: "x" },
				pose,
				origin,
				rayAtClient(view, startPt.x, startPt.y),
				view,
				BOUNDS,
				startPt.x,
				startPt.y,
				scale,
			),
			"dragX",
		);

		const free = expectValue(
			solveGizmoDragPose(
				dragX,
				rayAtClient(view, endPt.x, endPt.y),
				endPt.x,
				endPt.y,
				false,
				TEST_TUNING,
			),
			"free X",
		);
		expect(free.coords.x).toBeCloseTo(12.12, 2);
		expect(free.coords.y).toBeCloseTo(20, 5);
		expect(free.coords.z).toBeCloseTo(5, 5);

		const snapped = expectValue(
			solveGizmoDragPose(
				dragX,
				rayAtClient(view, endPt.x, endPt.y),
				endPt.x,
				endPt.y,
				true,
				TEST_TUNING,
			),
			"snapped X",
		);
		const step = TEST_TUNING.translateSnapMeters;
		expect(snapped.coords.x).toBeCloseTo(
			10 + Math.round(2.12 / step) * step,
			5,
		);

		// Huge ray offset along +X clamps cleanly to maxTranslateDistanceMeters.
		const clamped = expectValue(
			solveGizmoDragPose(
				dragX,
				{
					start: view.camera.placement.position.clone(),
					direction: new Vec3(0.999, 0, -0.01),
				},
				BOUNDS.width,
				BOUNDS.height / 2,
				false,
				TEST_TUNING,
			),
			"clamped X",
		);
		expect(clamped.coords.x).toBeCloseTo(
			pose.coords.x + TEST_TUNING.maxTranslateDistanceMeters,
			4,
		);

		// AC +Z (Up) maps to render +Y.
		const zStart = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y + 1, origin.z),
				view,
				BOUNDS,
			),
			"zStart",
		);
		const zEnd = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y + 2.5, origin.z),
				view,
				BOUNDS,
			),
			"zEnd",
		);
		const dragZ = expectValue(
			beginGizmoDrag(
				{ kind: "translate", axis: "z" },
				pose,
				origin,
				rayAtClient(view, zStart.x, zStart.y),
				view,
				BOUNDS,
				zStart.x,
				zStart.y,
				scale,
			),
			"dragZ",
		);
		const movedZ = expectValue(
			solveGizmoDragPose(
				dragZ,
				rayAtClient(view, zEnd.x, zEnd.y),
				zEnd.x,
				zEnd.y,
				false,
				TEST_TUNING,
			),
			"movedZ",
		);
		expect(movedZ.coords.x).toBeCloseTo(10, 5);
		expect(movedZ.coords.y).toBeCloseTo(20, 5);
		expect(movedZ.coords.z).toBeCloseTo(6.5, 2);

		// AC +Y (North) maps to render -Z; view from render +X looking toward -X so render -Z is left-right.
		const lookWest = new Quat(Math.SQRT1_2, 0, Math.SQRT1_2, 0);
		const sideView = makeCameraView(
			new Vec3(origin.x + 10, origin.y, origin.z),
			lookWest,
		);
		const yStart = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y, origin.z - 1),
				sideView,
				BOUNDS,
			),
			"yStart",
		);
		const yEnd = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y, origin.z - 3),
				sideView,
				BOUNDS,
			),
			"yEnd",
		);
		const dragY = expectValue(
			beginGizmoDrag(
				{ kind: "translate", axis: "y" },
				pose,
				origin,
				rayAtClient(sideView, yStart.x, yStart.y),
				sideView,
				BOUNDS,
				yStart.x,
				yStart.y,
				scale,
			),
			"dragY",
		);
		const movedY = expectValue(
			solveGizmoDragPose(
				dragY,
				rayAtClient(sideView, yEnd.x, yEnd.y),
				yEnd.x,
				yEnd.y,
				false,
				TEST_TUNING,
			),
			"movedY",
		);
		expect(movedY.coords.x).toBeCloseTo(10, 5);
		expect(movedY.coords.y).toBeCloseTo(22, 2);
		expect(movedY.coords.z).toBeCloseTo(5, 5);
	});

	it("returns null instead of teleporting backwards when a translation ray intersects behind the camera", () => {
		const pose: ExplorerWorldPose = {
			landblockId: 0x0001_ffff,
			coords: { x: 10, y: 20, z: 5 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		};
		const origin = worldPoseToSceneVec3(pose);
		const view = makeCameraView(
			new Vec3(origin.x, origin.y + 2, origin.z + 10),
		);
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			60,
			TEST_TUNING,
		);
		const startPt = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y, origin.z - 1),
				view,
				BOUNDS,
			),
			"startPt",
		);
		const drag = expectValue(
			beginGizmoDrag(
				{ kind: "translate", axis: "y" },
				pose,
				origin,
				rayAtClient(view, startPt.x, startPt.y),
				view,
				BOUNDS,
				startPt.x,
				startPt.y,
				scale,
			),
			"drag",
		);
		// Ray pointing upward above the +Y vanishing point has closest-point parameter s < 0.
		const behindCameraRay = {
			start: view.camera.placement.position.clone(),
			direction: new Vec3(0, 0.5, -0.866),
		};
		expect(
			solveGizmoDragPose(drag, behindCameraRay, 500, 50, false, TEST_TUNING),
		).toBeNull();
	});

	it("rotates around AC +Z (yaw) and AC +X (pitch), honors Shift snap, and returns null on horizon ray miss", () => {
		const pose: ExplorerWorldPose = {
			landblockId: 0x0001_ffff,
			coords: { x: 10, y: 20, z: 5 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		};
		const origin = worldPoseToSceneVec3(pose);
		// Look straight down at the AC XY horizontal plane: rotate camera -90 deg around render +X.
		const lookDown = new Quat(Math.SQRT1_2, -Math.SQRT1_2, 0, 0);
		const view = makeCameraView(
			new Vec3(origin.x, origin.y + 10, origin.z),
			lookDown,
		);
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			60,
			TEST_TUNING,
		);

		// Grab ring at AC +X (render +X), drag 90 deg CCW around AC +Z to AC +Y (render -Z).
		const grabPt = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x + 1, origin.y, origin.z),
				view,
				BOUNDS,
			),
			"grabPt",
		);
		const targetPt = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y, origin.z - 1),
				view,
				BOUNDS,
			),
			"targetPt",
		);
		const drag = expectValue(
			beginGizmoDrag(
				{ kind: "rotate", axis: "z" },
				pose,
				origin,
				rayAtClient(view, grabPt.x, grabPt.y),
				view,
				BOUNDS,
				grabPt.x,
				grabPt.y,
				scale,
			),
			"rotateZ drag",
		);
		expect(drag.kind === "rotate" && drag.mode.kind).toBe("plane");

		const rotated = expectValue(
			solveGizmoDragPose(
				drag,
				rayAtClient(view, targetPt.x, targetPt.y),
				targetPt.x,
				targetPt.y,
				false,
				TEST_TUNING,
			),
			"rotated Z",
		);
		// Rotating North (+Y) by +90 deg CCW around +Z yields West (-X).
		const forward = expectValue(
			tryEntityHorizontalForward(rotated.rotation),
			"forward",
		);
		expect(forward.x).toBeCloseTo(-1, 3);
		expect(forward.y).toBeCloseTo(0, 3);

		// Ray pointing away from the horizontal plane returns null instead of snapping back.
		expect(
			solveGizmoDragPose(
				drag,
				{
					start: view.camera.placement.position.clone(),
					direction: new Vec3(0, 1, 0),
				},
				500,
				0,
				false,
				TEST_TUNING,
			),
		).toBeNull();

		// Drag slightly past 22 deg with Shift snap -> snaps to test rotateSnapDegrees multiple.
		const slightAngle = (22 * Math.PI) / 180;
		const slightPt = expectValue(
			projectRenderPointToClient(
				new Vec3(
					origin.x + Math.cos(slightAngle),
					origin.y,
					origin.z - Math.sin(slightAngle),
				),
				view,
				BOUNDS,
			),
			"slightPt",
		);
		const snapped = expectValue(
			solveGizmoDragPose(
				drag,
				rayAtClient(view, slightPt.x, slightPt.y),
				slightPt.x,
				slightPt.y,
				true,
				TEST_TUNING,
			),
			"snapped Z",
		);
		const expectedAngle =
			(Math.round(22 / TEST_TUNING.rotateSnapDegrees) *
				TEST_TUNING.rotateSnapDegrees *
				Math.PI) /
			180;
		const snappedForward = expectValue(
			tryEntityHorizontalForward(snapped.rotation),
			"snappedForward",
		);
		expect(snappedForward.x).toBeCloseTo(-Math.sin(expectedAngle), 3);
		expect(snappedForward.y).toBeCloseTo(Math.cos(expectedAngle), 3);

		// Rotate +90 deg around AC +X from side view (looking toward render -X).
		const lookWest = new Quat(Math.SQRT1_2, 0, Math.SQRT1_2, 0);
		const sideView = makeCameraView(
			new Vec3(origin.x + 10, origin.y, origin.z),
			lookWest,
		);
		const xGrab = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y, origin.z - 1),
				sideView,
				BOUNDS,
			),
			"xGrab",
		);
		const xTarget = expectValue(
			projectRenderPointToClient(
				new Vec3(origin.x, origin.y + 1, origin.z),
				sideView,
				BOUNDS,
			),
			"xTarget",
		);
		const dragXRot = expectValue(
			beginGizmoDrag(
				{ kind: "rotate", axis: "x" },
				pose,
				origin,
				rayAtClient(sideView, xGrab.x, xGrab.y),
				sideView,
				BOUNDS,
				xGrab.x,
				xGrab.y,
				scale,
			),
			"rotateX drag",
		);
		const rotatedX = expectValue(
			solveGizmoDragPose(
				dragXRot,
				rayAtClient(sideView, xTarget.x, xTarget.y),
				xTarget.x,
				xTarget.y,
				false,
				TEST_TUNING,
			),
			"rotated X",
		);
		expect(rotatedX.rotation.w).toBeCloseTo(Math.SQRT1_2, 3);
		expect(rotatedX.rotation.x).toBeCloseTo(Math.SQRT1_2, 3);
		expect(rotatedX.rotation.y).toBeCloseTo(0, 3);
		expect(rotatedX.rotation.z).toBeCloseTo(0, 3);
	});

	it("uses screen-tangent fallback smoothly when dragging a rotation ring viewed edge-on", () => {
		const pose: ExplorerWorldPose = {
			landblockId: 0x0001_ffff,
			coords: { x: 10, y: 20, z: 5 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		};
		const origin = worldPoseToSceneVec3(pose);
		// Camera at exact same Y as origin -> AC +Z ring (horizontal plane) is viewed dead edge-on!
		const view = makeCameraView(new Vec3(origin.x, origin.y, origin.z + 10));
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			60,
			TEST_TUNING,
		);
		const center = expectValue(
			projectRenderPointToClient(origin, view, BOUNDS),
			"center",
		);

		const drag = expectValue(
			beginGizmoDrag(
				{ kind: "rotate", axis: "z" },
				pose,
				origin,
				rayAtClient(view, center.x, center.y),
				view,
				BOUNDS,
				center.x,
				center.y,
				scale,
			),
			"edge-on drag",
		);
		expect(drag.kind === "rotate" && drag.mode.kind).toBe("screen-tangent");

		const moved = expectValue(
			solveGizmoDragPose(
				drag,
				rayAtClient(view, center.x + 45, center.y),
				center.x + 45,
				center.y,
				false,
				TEST_TUNING,
			),
			"edge-on moved",
		);
		const norm = Math.hypot(
			moved.rotation.w,
			moved.rotation.x,
			moved.rotation.y,
			moved.rotation.z,
		);
		expect(norm).toBeCloseTo(1, 5);
		expect(Math.abs(moved.rotation.z)).toBeGreaterThan(0.1);
	});
});
