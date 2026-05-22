import { describe, expect, it } from "vitest";

import {
	convertBrowserFreeCameraStateBetweenAnchors,
	createBrowserFreeCameraState,
	prepareBrowserFreeCameraForDestinationFit,
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
});
