import { describe, expect, it } from "vitest";

import {
	buildCameraHintFromSceneCameraFrame,
	buildBrowserFreeCameraFrame,
	createBrowserFreeCameraState,
	DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
	fitBrowserFreeCameraToBounds,
	getBrowserFreeCameraSpeedMultiplier,
	moveBrowserFreeCameraLocal,
	moveBrowserFreeCameraLocalUpByWheel,
	panBrowserFreeCamera,
	rotateBrowserFreeCamera,
	rotateBrowserFreeCameraAroundLocalUp,
} from "./camera";
import { normalizeViewportPoint } from "./model";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 1,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x0102ffff,
			focusCellId: 0x01020001,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
	};
}

function createTestCameraConfig(): typeof DEFAULT_BROWSER_FREE_CAMERA_CONFIG {
	return { ...DEFAULT_BROWSER_FREE_CAMERA_CONFIG };
}

describe("world display camera helpers", () => {
	it("fits a browser free camera to scene bounds without claiming manual control", () => {
		const state = fitBrowserFreeCameraToBounds(
			createBrowserFreeCameraState(),
			{
				center: { x: 96, y: 18, z: -96 },
				size: { x: 576, y: 72, z: 576 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const frame = buildBrowserFreeCameraFrame(state);

		expect(state.hasManualControl).toBe(false);
		expect(frame.target).toEqual({ x: 96, y: 18, z: -96 });
		expect(frame.position.x).not.toBeCloseTo(frame.target.x);
		expect(frame.position.y).toBeGreaterThan(frame.target.y);
	});

	it("preserves manual rotation control across later automatic scene fits", () => {
		const fitted = fitBrowserFreeCameraToBounds(
			createBrowserFreeCameraState(),
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const manual = rotateBrowserFreeCamera(fitted, { x: 12, y: -8 });
		const next = fitBrowserFreeCameraToBounds(
			manual,
			{
				center: { x: 999, y: 999, z: 999 },
				size: { x: 400, y: 80, z: 400 },
				minimumSpan: 180,
			},
			"scene-b",
			{ force: false },
		);

		expect(next).toBe(manual);
	});

	it("maps downward mouse drag to increased browser camera pitch", () => {
		const state = {
			...createBrowserFreeCameraState(),
			pitchRadians: 0,
		};
		const rotated = rotateBrowserFreeCamera(state, { x: 0, y: 10 }, 1, {
			...createTestCameraConfig(),
			pointerPitchRadiansPerPixel: 0.01,
		});

		expect(rotated.pitchRadians).toBeCloseTo(0.1);
	});

	it("preserves manual wheel movement across later automatic scene fits", () => {
		const fitted = fitBrowserFreeCameraToBounds(
			createBrowserFreeCameraState(),
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const manual = moveBrowserFreeCameraLocalUpByWheel(fitted, -100);
		const next = fitBrowserFreeCameraToBounds(
			manual,
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);

		expect(next).toBe(manual);
		expect(next.position).toBe(manual.position);
	});

	it("supports explicit refit after manual movement", () => {
		const manual = panBrowserFreeCamera(
			moveBrowserFreeCameraLocalUpByWheel(createBrowserFreeCameraState(), -100),
			{ x: 30, y: -20 },
		);
		const refit = fitBrowserFreeCameraToBounds(
			manual,
			{
				center: { x: 32, y: 12, z: -48 },
				size: { x: 250, y: 40, z: 250 },
				minimumSpan: 180,
			},
			"scene-c",
			{ force: true },
		);

		expect(refit.hasManualControl).toBe(false);
		expect(buildBrowserFreeCameraFrame(refit).target).toEqual({
			x: 32,
			y: 12,
			z: -48,
		});
	});

	it("moves the browser free camera along its local forward axis", () => {
		const state = {
			...createBrowserFreeCameraState(),
			position: { x: 10, y: 20, z: 30 },
			yawRadians: 0,
			pitchRadians: 0,
			moveSpeed: 12,
		};
		const moved = moveBrowserFreeCameraLocal(
			state,
			{ right: 0, up: 0, forward: 1 },
			0.5,
		);

		expect(moved.position).toEqual({ x: 4, y: 20, z: 30 });
		expect(moved.hasManualControl).toBe(true);
	});

	it("moves the browser free camera along its local up axis from wheel input", () => {
		const state = {
			...createBrowserFreeCameraState(),
			position: { x: 10, y: 20, z: 30 },
			yawRadians: 0,
			pitchRadians: 0,
		};
		const moved = moveBrowserFreeCameraLocalUpByWheel(state, -100, 1, {
			...createTestCameraConfig(),
			wheelLocalUpUnitsPerDelta: 0.5,
		});

		expect(moved.position).toEqual({ x: 10, y: 70, z: 30 });
		expect(moved.focusDistance).toBe(state.focusDistance);
		expect(moved.hasManualControl).toBe(true);
	});

	it("moves the browser free camera along its local right axis", () => {
		const state = {
			...createBrowserFreeCameraState(),
			position: { x: 10, y: 20, z: 30 },
			yawRadians: 0,
			pitchRadians: 0,
			moveSpeed: 12,
		};
		const moved = moveBrowserFreeCameraLocal(
			state,
			{ right: 1, up: 0, forward: 0 },
			0.5,
		);

		expect(moved.position).toEqual({ x: 10, y: 20, z: 24 });
		expect(moved.hasManualControl).toBe(true);
	});

	it("rotates the browser free camera around its local up axis", () => {
		const state = {
			...createBrowserFreeCameraState(),
			yawRadians: 2,
		};
		const rotated = rotateBrowserFreeCameraAroundLocalUp(state, 1, 0.5, 1, {
			...createTestCameraConfig(),
			keyboardYawRadiansPerSecond: 4,
		});

		expect(rotated.yawRadians).toBeCloseTo(4);
		expect(rotated.pitchRadians).toBe(state.pitchRadians);
		expect(rotated.hasManualControl).toBe(true);
	});

	it("scales browser free camera motion and rotation with a speed multiplier", () => {
		const state = {
			...createBrowserFreeCameraState(),
			position: { x: 10, y: 20, z: 30 },
			yawRadians: 0,
			pitchRadians: 0,
			moveSpeed: 12,
		};
		const moved = moveBrowserFreeCameraLocal(
			state,
			{ right: 0, up: 0, forward: 1 },
			0.5,
			0.5,
		);
		const rotated = rotateBrowserFreeCameraAroundLocalUp(state, 1, 0.5, 0.5, {
			...createTestCameraConfig(),
			keyboardYawRadiansPerSecond: 4,
		});

		expect(moved.position).toEqual({ x: 7, y: 20, z: 30 });
		expect(rotated.yawRadians).toBeCloseTo(1);
	});

	it("derives the slow camera speed multiplier from config", () => {
		expect(
			getBrowserFreeCameraSpeedMultiplier(true, {
				...createTestCameraConfig(),
				shiftSlowMultiplier: 0.25,
			}),
		).toBe(0.25);
		expect(getBrowserFreeCameraSpeedMultiplier(false)).toBe(1);
	});

	it("applies configured camera projection properties to browser frames", () => {
		const frame = buildBrowserFreeCameraFrame(createBrowserFreeCameraState(), {
			...createTestCameraConfig(),
			fovDegrees: 61,
			near: 0.5,
			far: 900,
		});

		expect(frame.fovDegrees).toBe(61);
		expect(frame.near).toBe(0.5);
		expect(frame.far).toBe(900);
	});

	it("builds camera hints from the rendered Three.js camera frame in AC coordinates", () => {
		const hint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 10, y: 20, z: -30 },
				target: { x: 10, y: 20, z: -40 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 1,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(40, 40, 80, 80),
		);

		expect(hint).not.toBeNull();
		expect(hint?.position).toEqual({ x: 10, y: 30, z: 20 });
		expect(hint?.forward).toEqual({ x: 0, y: 1, z: 0 });
		expect(hint?.viewportNormalizedX).toBeCloseTo(0.5);
		expect(hint?.destinationLabel).toBe("100.40S, 101.55W, 1.0Z");
	});

	it("converts camera hint positions through the active render anchor", () => {
		const firstAnchorHint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 12, y: 3, z: -199 },
				target: { x: 12, y: 3, z: -209 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 1,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(40, 40, 80, 80),
			{ landblockId: 0xdb55ffff },
		);
		const rebasedHint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 204, y: 3, z: -199 },
				target: { x: 204, y: 3, z: -209 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 1,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(40, 40, 80, 80),
			{ landblockId: 0xda55ffff },
		);

		expect(firstAnchorHint?.position).toEqual({ x: 42060, y: 16519, z: 3 });
		expect(rebasedHint?.position).toEqual(firstAnchorHint?.position);
		expect(rebasedHint?.forward).toEqual({ x: 0, y: 1, z: 0 });
	});

	it("derives off-center pick rays from camera FOV and aspect", () => {
		const hint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 10, y: 20, z: -30 },
				target: { x: 10, y: 20, z: -40 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 2,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(80, 0, 80, 80),
		);

		expect(hint?.forward.x).toBeGreaterThan(0);
		expect(hint?.forward.y).toBeGreaterThan(0);
		expect(hint?.forward.z).toBeGreaterThan(0);
		expect(
			Math.hypot(
				hint?.forward.x ?? 0,
				hint?.forward.y ?? 0,
				hint?.forward.z ?? 0,
			),
		).toBeCloseTo(1);
	});
});
