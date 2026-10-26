import { describe, expect, it } from "vitest";

import type { PreparedAnimation } from "./animation-asset-repository";
import { playingClip } from "./animation-playback";
import { Mat4, Quat, Vec3 } from "../math/types";
import { AnimationSequence } from "./animation-sequence";

describe("AnimationSequence", () => {
	it("samples fractional time across a clip boundary without advancing the semantic cursor", () => {
		const animation = preparedAnimation();
		const sequence = new AnimationSequence(
			[
				playingClip(animation, 0, 1, 2, "hold"),
				playingClip(animation, 2, 3, 2, "loop"),
			],
			1,
			[Mat4.identity()],
		);
		sequence.advance(0.9, () => {});
		const before = sequence.samplePose()[0]?.m41;
		expect(sequence.sample(0.2).partToObjectTransforms[0]?.m41).toBeCloseTo(
			2.2,
		);
		expect(sequence.samplePose()[0]?.m41).toBe(before);
		sequence.advance(0.2, () => {});
		expect(sequence.samplePose()[0]?.m41).toBeCloseTo(2.2);
	});
	it("preserves phase for the same animation while rebasing fallback parts to the replacement setup", () => {
		const clip = playingClip(preparedAnimation(), 0, 3, 2, "loop");
		const original = new AnimationSequence([clip], 0, [
			Mat4.identity(),
			Mat4.identity(),
		]);
		original.advance(0.75, () => {});
		const extra = Mat4.identity();
		extra.m41 = 7;
		const replacement = original.replacement([clip], 0, [
			Mat4.identity(),
			extra,
		]);
		expect(replacement.samplePose()[0]?.m41).toBeCloseTo(1.5);
		expect(replacement.samplePose()[1]?.m41).toBe(7);
		replacement.advance(0.25, () => {});
		expect(replacement.samplePose()[0]?.m41).toBe(2);
		expect(original.samplePose()[0]?.m41).toBeCloseTo(1.5);
		const changed = original.replacement(
			[playingClip(clip.animation, 0, 1, 2, "loop")],
			0,
			[Mat4.identity()],
		);
		expect(changed.samplePose()[0]?.m41).toBe(0);
	});
	it("crosses a captured prefix into its cyclic tail without losing traversed frames", () => {
		const animation = preparedAnimation();
		const prefix = playingClip(animation, 0, 1, 2, "hold");
		const tail = playingClip(animation, 2, 3, 2, "loop");
		const sequence = new AnimationSequence([prefix, tail], 1, [
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
		const sequence = new AnimationSequence([clip], 0, [Mat4.identity()]);
		const departed: number[] = [];

		sequence.advance(0.5, ({ departedFrames }) =>
			departed.push(...departedFrames),
		);

		expect(departed).toEqual([3]);
		expect(sequence.samplePose()[0]?.m41).toBeCloseTo(3, 3);
	});

	it("crosses several clips and repeats only the cyclic tail in one advancement", () => {
		const base = preparedAnimation();
		const clips = [
			playingClip(base, 0, 1, 2, "hold"),
			playingClip({ ...base, id: "0x03000002" }, 1, 2, 2, "loop"),
			playingClip({ ...base, id: "0x03000003" }, 2, 3, 2, "loop"),
		];
		const sequence = new AnimationSequence(clips, 1, [Mat4.identity()]);
		const crossed: { id: string; frames: readonly number[] }[] = [];
		sequence.advance(4, ({ clip, departedFrames }) =>
			crossed.push({ id: clip.animation.id, frames: departedFrames }),
		);
		expect(crossed).toEqual([
			{ id: "0x03000001", frames: [0] },
			{ id: "0x03000002", frames: [1] },
			{ id: "0x03000003", frames: [2] },
			{ id: "0x03000002", frames: [1] },
		]);
		expect(sequence.samplePose()[0]?.m41).toBe(2);
	});

	it("retains setup pose without clips and holds a zero-rate sequence without dispatch", () => {
		const setup = Mat4.identity();
		setup.m41 = 9;
		const still = new AnimationSequence([], null, [setup]);
		setup.m41 = 10;
		const crossed: number[] = [];
		still.advance(20, ({ departedFrames }) => crossed.push(...departedFrames));
		expect(still.samplePose()[0]?.m41).toBe(9);
		expect(still.sampleAuthoredRoot()).toBeNull();
		const zero = new AnimationSequence(
			[playingClip(preparedAnimation(), 1, 3, 0, "loop")],
			0,
			[Mat4.identity()],
		);
		zero.advance(20, ({ departedFrames }) => crossed.push(...departedFrames));
		expect(zero.samplePose()[0]?.m41).toBe(1);
		expect(crossed).toEqual([]);
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
