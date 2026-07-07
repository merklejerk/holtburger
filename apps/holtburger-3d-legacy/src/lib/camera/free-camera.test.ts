import { describe, expect, it } from "vitest";

import {
	createFreeCameraFrameStateCamera,
	createFreeCameraState,
	getFreeCameraAxes,
	getFreeCameraKeyboardMoveSpeedMultiplier,
	moveFreeCameraLocal,
	moveFreeCameraLocalUpByWheel,
	panFreeCamera,
	rotateFreeCamera,
	rotateFreeCameraAroundWorldUp,
} from "./free-camera";

describe("browser free camera", () => {
	it("uses the renderer yaw convention", () => {
		expect(
			getFreeCameraAxes({ yawRadians: 0, pitchRadians: 0 }).forward,
		).toEqual([0, 0, -1]);
		expect(
			getFreeCameraAxes({ yawRadians: Math.PI / 2, pitchRadians: 0 })
				.forward[0],
		).toBeCloseTo(1);
	});

	it("rotates from pointer deltas and clamps pitch", () => {
		const state = rotateFreeCamera(
			createFreeCameraState(),
			{ x: 10, y: -1000 },
			1,
		);

		expect(state.yawRadians).toBeCloseTo(-0.06);
		expect(state.pitchRadians).toBeCloseTo(-1.38);
		expect(state.hasManualControl).toBe(true);
	});

	it("moves in camera-local axes", () => {
		const state = moveFreeCameraLocal(
			{
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
				moveSpeed: 10,
			},
			{ forward: 1, right: 0, up: 0 },
			0.5,
		);

		expect(state.position[0]).toBeCloseTo(0);
		expect(state.position[1]).toBeCloseTo(0);
		expect(state.position[2]).toBeCloseTo(-5);
	});

	it("pans across camera right and up", () => {
		const state = panFreeCamera(
			{
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
				focusDistance: 100,
			},
			{ x: 10, y: 20 },
		);

		expect(state.position[0]).toBeCloseTo(-0.5);
		expect(state.position[1]).toBeCloseTo(1);
		expect(state.position[2]).toBeCloseTo(0);
	});

	it("moves along local up for wheel input", () => {
		const state = moveFreeCameraLocalUpByWheel(
			{
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
			},
			100,
		);

		expect(state.position[0]).toBeCloseTo(0);
		expect(state.position[1]).toBeCloseTo(2.5);
		expect(state.position[2]).toBeCloseTo(0);
	});

	it("rotates around world up from keyboard yaw", () => {
		const state = rotateFreeCameraAroundWorldUp(
			createFreeCameraState(),
			1,
			0.5,
		);

		expect(state.yawRadians).toBeCloseTo(0.9);
	});

	it("ramps keyboard movement from initial to full speed", () => {
		expect(getFreeCameraKeyboardMoveSpeedMultiplier(0)).toBeCloseTo(0.125);
		expect(getFreeCameraKeyboardMoveSpeedMultiplier(1)).toBeCloseTo(0.5625);
		expect(getFreeCameraKeyboardMoveSpeedMultiplier(4)).toBeCloseTo(1);
	});

	it("builds the renderer camera frame state", () => {
		const state = {
			...createFreeCameraState(),
			position: [1, 2, 3] as const,
			yawRadians: 0.25,
			pitchRadians: -0.5,
		};

		expect(createFreeCameraFrameStateCamera(state)).toEqual({
			position: [1, 2, 3],
			yawRadians: 0.25,
			pitchRadians: -0.5,
		});
	});
});
