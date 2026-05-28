import { describe, expect, it } from "vitest";

import {
	convertBrowserFreeCameraStateBetweenAnchors,
	createBrowserFreeCameraState,
	buildBrowserFreeCameraFrame,
	prepareBrowserFreeCameraForDestinationFit,
	syncBrowserFreeCameraStateFromFrame,
} from "./camera";
import { convertCameraFrameBetweenAnchors } from "./render-chunks";

describe("browser camera helpers", () => {
	it("rebases free-camera state with the same offset as scene camera frames", () => {
		const oldAnchorLandblockId = 0xda55ffff;
		const newAnchorLandblockId = 0xdb55ffff;
		const state = {
			...createBrowserFreeCameraState(),
			position: { x: 40, y: 30, z: -20 },
			hasManualControl: true,
			lastFitKey: "initial-fit",
		};
		const convertedState = convertBrowserFreeCameraStateBetweenAnchors(
			state,
			oldAnchorLandblockId,
			newAnchorLandblockId,
		);
		const convertedFrame = convertCameraFrameBetweenAnchors(
			{
				position: state.position,
				target: { x: 40, y: 30, z: -30 },
				up: { x: 0, y: 1, z: 0 },
			},
			oldAnchorLandblockId,
			newAnchorLandblockId,
		);

		expect(convertedState).toEqual({
			...state,
			position: convertedFrame.position,
		});
		expect(convertedState.hasManualControl).toBe(true);
		expect(convertedState.lastFitKey).toBe("initial-fit");
	});

	it("prepares manually controlled camera state for a destination fit", () => {
		const state = {
			...createBrowserFreeCameraState(),
			hasManualControl: true,
			lastFitKey: "previous-scene",
		};

		expect(prepareBrowserFreeCameraForDestinationFit(state)).toEqual({
			...state,
			hasManualControl: false,
			lastFitKey: null,
		});
	});

	it("syncs free-camera state from a renderer-owned frame before manual input", () => {
		const state = createBrowserFreeCameraState();
		const frame = {
			position: { x: 100, y: 40, z: -25 },
			target: { x: 80, y: 30, z: -85 },
			up: { x: 0, y: 1, z: 0 },
			aspect: 16 / 9,
			fovDegrees: 52,
			near: 0.1,
			far: 5000,
		};

		const syncedState = syncBrowserFreeCameraStateFromFrame(state, frame);
		const syncedFrame = buildBrowserFreeCameraFrame(syncedState);

		expect(syncedFrame.position).toEqual(frame.position);
		expect(syncedFrame.target.x).toBeCloseTo(frame.target.x);
		expect(syncedFrame.target.y).toBeCloseTo(frame.target.y);
		expect(syncedFrame.target.z).toBeCloseTo(frame.target.z);
	});
});
