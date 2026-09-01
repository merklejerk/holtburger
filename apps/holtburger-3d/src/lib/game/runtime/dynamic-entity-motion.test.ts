import { describe, expect, it } from "vitest";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { Mat4 } from "../math/types";
import type { DynamicEntityMotion } from "./dynamic-entity-feed";
import {
	classifyDynamicEntityMotionUpdate,
	playingClipForDynamicEntityMotion,
} from "./dynamic-entity-motion";

const animation: PreparedAnimation = {
	authoredRootTranslates: false,
	frameCount: 32,
	framesPerSecond: 30,
	hooks: [],
	id: "0x03000559",
	partCount: 1,
	partFrames: Array.from({ length: 32 }, () => Mat4.identity()),
	positionFrames: [],
};

const opening: DynamicEntityMotion = {
	kind: "playing",
	animationId: 0x0300_0559,
	completion: "hold",
	framerate: 30,
	highFrame: 31,
	lowFrame: 0,
};

describe("dynamic entity motion presentation", () => {
	it("turns a settled level into one exact stationary frame", () => {
		const clip = playingClipForDynamicEntityMotion(animation, {
			kind: "settled",
			animationId: 0x0300_0559,
			frame: 31,
		});

		expect(clip).toMatchObject({
			completion: "hold",
			framesPerSecond: 0,
			highFrame: 31,
			lowFrame: 31,
		});
	});

	it("does not reinstall a settled pose that confirms local forward completion", () => {
		expect(
			classifyDynamicEntityMotionUpdate(
				{ level: opening, playback: "installed" },
				{
					kind: "settled",
					animationId: opening.animationId,
					frame: 31,
				},
			),
		).toBe("confirm");
		expect(
			classifyDynamicEntityMotionUpdate(
				{
					level: { ...opening, framerate: -30 },
					playback: "installed",
				},
				{
					kind: "settled",
					animationId: opening.animationId,
					frame: 0,
				},
			),
		).toBe("confirm");
	});

	it("installs initial and contradictory settled poses as authoritative corrections", () => {
		const settledOpen: DynamicEntityMotion = {
			kind: "settled",
			animationId: opening.animationId,
			frame: 31,
		};
		expect(classifyDynamicEntityMotionUpdate(null, settledOpen)).toBe(
			"install",
		);
		expect(
			classifyDynamicEntityMotionUpdate(
				{ level: opening, playback: "unplayable" },
				settledOpen,
			),
		).toBe("install");
		expect(
			classifyDynamicEntityMotionUpdate(
				{
					level: { ...opening, framerate: -30 },
					playback: "installed",
				},
				settledOpen,
			),
		).toBe("install");
	});
});
