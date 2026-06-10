import { describe, expect, it } from "vitest";

import {
	createV2FreeCameraFrameStateCamera,
	createV2FreeCameraState,
	getV2FreeCameraAxes,
	getV2FreeCameraKeyboardMoveSpeedMultiplier,
	moveV2FreeCameraLocal,
	moveV2FreeCameraLocalUpByWheel,
	panV2FreeCamera,
	rotateV2FreeCamera,
	rotateV2FreeCameraAroundWorldUp,
} from "./free-camera";

describe("V2 free camera", () => {
	it("uses the V2 renderer yaw convention", () => {
		expect(
			getV2FreeCameraAxes({ yawRadians: 0, pitchRadians: 0 }).forward,
		).toEqual([0, 0, -1]);
		expect(
			getV2FreeCameraAxes({ yawRadians: Math.PI / 2, pitchRadians: 0 })
				.forward[0],
		).toBeCloseTo(1);
	});

	it("rotates from pointer deltas and clamps pitch", () => {
		const state = rotateV2FreeCamera(
			createV2FreeCameraState(),
			{ x: 10, y: -1000 },
			1,
		);

		expect(state.yawRadians).toBeCloseTo(-0.06);
		expect(state.pitchRadians).toBeCloseTo(-1.38);
		expect(state.hasManualControl).toBe(true);
	});

	it("moves in camera-local axes", () => {
		const state = moveV2FreeCameraLocal(
			{
				...createV2FreeCameraState(),
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
		const state = panV2FreeCamera(
			{
				...createV2FreeCameraState(),
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
		const state = moveV2FreeCameraLocalUpByWheel(
			{
				...createV2FreeCameraState(),
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
		const state = rotateV2FreeCameraAroundWorldUp(
			createV2FreeCameraState(),
			1,
			0.5,
		);

		expect(state.yawRadians).toBeCloseTo(0.9);
	});

	it("ramps keyboard movement from initial to full speed", () => {
		expect(getV2FreeCameraKeyboardMoveSpeedMultiplier(0)).toBeCloseTo(0.125);
		expect(getV2FreeCameraKeyboardMoveSpeedMultiplier(1)).toBeCloseTo(0.5625);
		expect(getV2FreeCameraKeyboardMoveSpeedMultiplier(4)).toBeCloseTo(1);
	});

	it("builds the renderer camera frame state", () => {
		const state = {
			...createV2FreeCameraState(),
			position: [1, 2, 3] as const,
			yawRadians: 0.25,
			pitchRadians: -0.5,
		};

		expect(createV2FreeCameraFrameStateCamera(state)).toEqual({
			position: [1, 2, 3],
			yawRadians: 0.25,
			pitchRadians: -0.5,
		});
	});
});
