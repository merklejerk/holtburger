import { describe, expect, it, vi } from "vitest";
import { sceneVec3 } from "../../lib/assets/ac-frame";
import { rotateRenderVector } from "../../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../../lib/game/math/types";
import {
	TRANSFORM_GIZMO_GEOMETRY,
	type TransformGizmoVisual,
} from "../../lib/game/renderer/overlays/transform-gizmo-contract";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type { ExplorerWorldPose } from "../entities/entity-commands";
import {
	ExplorerTransformGizmoController,
	type TransformGizmoCursor,
	type TransformGizmoTarget,
} from "./transform-gizmo-controller";
import {
	computeGizmoScale,
	projectRenderPointToClient,
	worldPoseToSceneVec3,
	type GizmoCanvasBounds,
} from "./transform-gizmo-math";

const BOUNDS: GizmoCanvasBounds = { left: 0, top: 0, width: 1000, height: 800 };

function makeView(origin: Vec3): PrimaryCameraView {
	return {
		camera: {
			fov: 60,
			near: 0.1,
			far: 1000,
			placement: {
				landblockId: "0x0001ffff",
				envCellId: null,
				position: sceneVec3(new Vec3(origin.x, origin.y + 1, origin.z + 10)),
				rotation: Quat.identity(),
			},
		},
		extent: { width: BOUNDS.width, height: BOUNDS.height },
	};
}

function makeRay(view: PrimaryCameraView, clientX: number, clientY: number) {
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

function createHarness() {
	const initialPose: ExplorerWorldPose = {
		landblockId: 0x0001_ffff,
		coords: { x: 10, y: 20, z: 0 },
		rotation: { w: 1, x: 0, y: 0, z: 0 },
	};
	const origin = worldPoseToSceneVec3(initialPose);
	const view = makeView(origin);
	const scale = computeGizmoScale(view.camera.placement.position, origin, 60);
	let target: TransformGizmoTarget | null = {
		guid: 0x8000_0001,
		generation: 1,
		pose: initialPose,
	};
	let latestVisual: TransformGizmoVisual | null = null;
	let latestCursor: TransformGizmoCursor = null;
	const setVisual = vi.fn((visual: TransformGizmoVisual | null) => {
		latestVisual = visual;
	});
	const onTransformPose = vi.fn();
	const onCancelTransform = vi.fn();
	const fakeCanvas = {} as HTMLCanvasElement;

	const controller = new ExplorerTransformGizmoController({
		readTarget: () => target,
		readPrimaryView: () => view,
		readCanvas: () => fakeCanvas,
		setVisual,
		onTransformPose,
		onCancelTransform,
		onCursorChange: (cursor) => {
			latestCursor = cursor;
		},
		sampleRay: (v, _c, x, y) => makeRay(v, x, y),
		readCanvasBounds: () => BOUNDS,
	});

	const xTip = projectRenderPointToClient(
		new Vec3(
			origin.x + TRANSFORM_GIZMO_GEOMETRY.coneEnd * scale,
			origin.y,
			origin.z,
		),
		view,
		BOUNDS,
	);
	if (xTip === null) throw new Error("Expected projected xTip.");

	return {
		controller,
		initialPose,
		origin,
		view,
		scale,
		xTip,
		setTarget: (next: TransformGizmoTarget | null) => {
			target = next;
		},
		getVisual: () => latestVisual,
		getCursor: () => latestCursor,
		setVisual,
		onTransformPose,
		onCancelTransform,
	};
}

describe("ExplorerTransformGizmoController", () => {
	it("updates hover highlight and grab cursor on pointer hover and clears on miss", () => {
		const h = createHarness();
		h.controller.handlePointerHover(h.xTip.x, h.xTip.y);
		expect(h.getVisual()?.hovered).toEqual({ kind: "translate", axis: "x" });
		expect(h.getCursor()).toBe("grab");

		h.controller.handlePointerHover(5, 5);
		expect(h.getVisual()?.hovered).toBeNull();
		expect(h.getCursor()).toBeNull();
	});

	it("claims drag, emits translated poses, clears sticky hover on commit, and holds preview until mirror updates", () => {
		const h = createHarness();
		expect(h.controller.tryBeginDrag(5, 5)).toBe(false);
		expect(h.controller.isDragging()).toBe(false);

		expect(h.controller.tryBeginDrag(h.xTip.x, h.xTip.y)).toBe(true);
		expect(h.controller.isDragging()).toBe(true);
		expect(h.getCursor()).toBe("grabbing");
		expect(h.getVisual()?.active).toEqual({ kind: "translate", axis: "x" });

		h.controller.updateDrag(h.xTip.x + 80, h.xTip.y, false);
		expect(h.onTransformPose).toHaveBeenCalledTimes(1);
		const movedPose = h.onTransformPose.mock.calls[0]?.[2] as ExplorerWorldPose;
		expect(movedPose.coords.x).toBeGreaterThan(h.initialPose.coords.x);

		h.controller.endDrag(true);
		expect(h.controller.isDragging()).toBe(false);
		expect(h.getCursor()).toBeNull();
		expect(h.getVisual()?.hovered).toBeNull();
		expect(h.onCancelTransform).not.toHaveBeenCalled();

		// Gizmo stays at the released preview pose rather than flickering back to the stale mirror pose.
		const expectedPos = worldPoseToSceneVec3(movedPose);
		expect(h.getVisual()?.position.x).toBeCloseTo(expectedPos.x, 4);

		// Idle syncVisual skips redundant publishes when neither camera nor pose changed.
		const callsBeforeIdle = h.setVisual.mock.calls.length;
		h.controller.syncVisual();
		expect(h.setVisual).toHaveBeenCalledTimes(callsBeforeIdle);
	});

	it("reverts to the pre-drag startPose when cancelled", () => {
		const h = createHarness();
		expect(h.controller.tryBeginDrag(h.xTip.x, h.xTip.y)).toBe(true);
		h.controller.updateDrag(h.xTip.x + 80, h.xTip.y, false);

		h.controller.endDrag(false);
		expect(h.controller.isDragging()).toBe(false);
		expect(h.onCancelTransform).toHaveBeenCalledWith(
			0x8000_0001,
			1,
			h.initialPose,
		);
	});

	it("hides visual and drops drag cleanly if the target disappears mid-drag", () => {
		const h = createHarness();
		expect(h.controller.tryBeginDrag(h.xTip.x, h.xTip.y)).toBe(true);

		h.setTarget(null);
		h.controller.syncVisual();
		expect(h.controller.isDragging()).toBe(false);
		expect(h.getVisual()).toBeNull();
		expect(h.getCursor()).toBeNull();
	});
});
