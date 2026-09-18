import { describe, expect, it } from "vitest";

import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { playingClip } from "../animation/animation-playback";
import { Mat4, Quat, Vec3 } from "../math/types";
import { ObjectPreviewSequence } from "./object-preview-sequence";

describe("ObjectPreviewSequence", () => {
	it("crosses a captured prefix into its cyclic tail without losing traversed frames", () => {
		const animation = preparedAnimation();
		const prefix = playingClip(animation, 0, 1, 2, "hold");
		const tail = playingClip(animation, 2, 3, 2, "loop");
		const sequence = new ObjectPreviewSequence([prefix, tail], 1, [
			Mat4.identity(),
		]);
		const traversals: {
			readonly id: string;
			readonly frames: readonly number[];
		}[] = [];

		sequence.advance(1.5, ({ clip, departedFrames }) =>
			traversals.push({ id: clip.animation.id, frames: departedFrames }),
		);

		expect(traversals).toEqual([
			{ id: "0x03000001", frames: [0] },
			{ id: "0x03000001", frames: [2] },
		]);
		expect(sequence.samplePose()[0]?.m41).toBe(3);
	});

	it("reports reverse traversal in playback order", () => {
		const animation = preparedAnimation();
		const clip = playingClip(animation, 1, 3, -2, "loop");
		const sequence = new ObjectPreviewSequence([clip], 0, [Mat4.identity()]);
		const departed: number[] = [];

		sequence.advance(0.5, ({ departedFrames }) =>
			departed.push(...departedFrames),
		);

		expect(departed).toEqual([3]);
		expect(sequence.samplePose()[0]?.m41).toBeCloseTo(3, 3);
	});
});

function preparedAnimation(): PreparedAnimation {
	return {
		authoredRootTranslates: false,
		emitterInfoIds: [],
		frameCount: 4,
		framesPerSecond: 30,
		hooks: [],
		id: "0x03000001",
		partCount: 1,
		partFrames: [0, 1, 2, 3].map((position) => ({
			rotation: Quat.identity(),
			translation: new Vec3(position, 0, 0),
		})),
		positionFrames: [],
	};
}
