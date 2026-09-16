import { describe, expect, it } from "vitest";
import { prepareAnimation } from "../animation/animation-asset-repository";
import { Mat4 } from "../math/types";
import type {
	DynamicEntityClip,
	DynamicEntityMotionLayer,
} from "./dynamic-entity-feed";
import {
	classifyDynamicEntityMotionUpdate,
	playingClipForDynamicEntityMotion,
} from "./dynamic-entity-motion";

const animation = prepareAnimation(
	{
		frameCount: 32,
		hooks: [],
		id: "0x03000559",
		partCount: 1,
		partFrames: Array.from({ length: 32 }, () => Mat4.identity()),
		positionFrames: [],
	},
	"0x03000559",
	30,
);

const opening: DynamicEntityClip = {
	kind: "playing",
	animationId: 0x0300_0559,
	completion: "hold",
	framerate: 30,
	highFrame: 31,
	lowFrame: 0,
};

function classifyClipUpdate(
	current: {
		level: DynamicEntityClip;
		playback: "installed" | "unplayable";
	} | null,
	next: DynamicEntityClip,
) {
	return classifyDynamicEntityMotionUpdate(
		current === null
			? null
			: { ...current, level: { playbackId: "1", clip: current.level } },
		{ playbackId: "1", clip: next },
	);
}

describe("dynamic entity motion presentation", () => {
	it("reinstalls an identical clip only when its occurrence changes", () => {
		const level: DynamicEntityMotionLayer = { playbackId: "1", clip: opening };
		const current = { level, playback: "installed" as const };
		expect(classifyDynamicEntityMotionUpdate(current, level)).toBe("unchanged");
		expect(
			classifyDynamicEntityMotionUpdate(current, { ...level, playbackId: "2" }),
		).toBe("install");
	});

	it("confirms a matching settled successor with a fresh occurrence identity", () => {
		expect(
			classifyDynamicEntityMotionUpdate(
				{ level: { playbackId: "1", clip: opening }, playback: "installed" },
				{
					playbackId: "2",
					clip: {
						kind: "settled",
						animationId: opening.animationId,
						frame: opening.highFrame,
					},
				},
			),
		).toBe("confirm");
	});

	it("retimes an installed cycle when only its speed changes", () => {
		const running = { ...opening, completion: "loop" as const };
		expect(
			classifyClipUpdate(
				{ level: running, playback: "installed" },
				{ ...running, framerate: running.framerate + 0.001 },
			),
		).toBe("retime");
		expect(
			classifyClipUpdate(
				{ level: running, playback: "unplayable" },
				{ ...running, framerate: running.framerate + 0.001 },
			),
		).toBe("install");
	});

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
			classifyClipUpdate(
				{ level: opening, playback: "installed" },
				{
					kind: "settled",
					animationId: opening.animationId,
					frame: 31,
				},
			),
		).toBe("confirm");
		expect(
			classifyClipUpdate(
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
		const settledOpen: DynamicEntityClip = {
			kind: "settled",
			animationId: opening.animationId,
			frame: 31,
		};
		expect(classifyClipUpdate(null, settledOpen)).toBe("install");
		expect(
			classifyClipUpdate(
				{ level: opening, playback: "unplayable" },
				settledOpen,
			),
		).toBe("install");
		expect(
			classifyClipUpdate(
				{
					level: { ...opening, framerate: -30 },
					playback: "installed",
				},
				settledOpen,
			),
		).toBe("install");
	});
});
