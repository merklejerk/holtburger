import { describe, expect, it } from "vitest";
import { createRotationMat4, transformPoint3 } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import {
	advanceCyclicFrame,
	clipEntryFrame,
	interpolateRigidTransform,
	playingClip,
	rotationVectorQuaternion,
	sampleAnimationPose,
	wholeAnimationClip,
} from "./animation-playback";
import type { PreparedAnimation } from "./animation-asset-repository";

/** Frames are distinguishable by their x translation, so a sampled pose names its frame. */
function testAnimation(frameCount: number): PreparedAnimation {
	return {
		frameCount,
		framesPerSecond: 30,
		hooks: [],
		id: "0x03000001",
		partCount: 1,
		partFrames: Array.from({ length: frameCount }, (_, frame) => {
			const pose = Mat4.identity();
			pose.m41 = frame * 10;
			return pose;
		}),
		positionFrames: [],
	};
}

describe("playingClip", () => {
	it("rejects a window that does not fit the animation it indexes", () => {
		expect(() => playingClip(testAnimation(5), 0, 5, 30)).toThrow(
			/does not fit/,
		);
		expect(() => playingClip(testAnimation(5), 3, 1, 30)).toThrow(
			/does not fit/,
		);
		expect(() => playingClip(testAnimation(5), -1, 4, 30)).toThrow(
			/does not fit/,
		);
	});

	it("enters a forward clip at its low frame and a reversed clip inside its high frame", () => {
		expect(clipEntryFrame(playingClip(testAnimation(5), 1, 3, 30))).toBe(1);
		// Just inside the high frame, so the first departure leaves it rather than skipping it.
		const reversed = playingClip(testAnimation(5), 1, 3, -30);
		expect(clipEntryFrame(reversed)).toBeGreaterThan(3);
		expect(clipEntryFrame(reversed)).toBeLessThan(4);
	});
});

describe("advanceCyclicFrame", () => {
	it("visits forward departed frames once and excludes the terminal seam frame", () => {
		const clip = wholeAnimationClip(testAnimation(5));
		expect(advanceCyclicFrame(clip, 1.5, 4 / clip.framesPerSecond)).toEqual({
			departedFrames: [1, 2, 3],
			framePosition: 0.5,
		});
	});

	it("visits reverse departed frames once and excludes the low seam frame", () => {
		const clip = playingClip(testAnimation(5), 0, 4, -30);
		// Lapping re-enters just inside the high frame, so frame 4 is not departed until the
		// cursor crosses back below it.
		expect(advanceCyclicFrame(clip, 3.5, 4 / 30)).toEqual({
			departedFrames: [3, 2, 1],
			framePosition: expect.closeTo(4.4998, 4),
		});
	});

	it("never leaves the authored window", () => {
		const clip = playingClip(testAnimation(10), 4, 6, 30);
		let position = clipEntryFrame(clip);
		const visited: number[] = [];
		for (let step = 0; step < 40; step += 1) {
			const advance = advanceCyclicFrame(clip, position, 0.25 / 30);
			position = advance.framePosition;
			visited.push(...advance.departedFrames);
			expect(position).toBeGreaterThanOrEqual(clip.lowFrame);
			expect(position).toBeLessThan(clip.highFrame + 1);
		}
		expect(new Set(visited)).toEqual(new Set([4, 5]));
	});

	it("laps back to the entry frame instead of holding at the far bound", () => {
		const clip = playingClip(testAnimation(10), 4, 6, 30);
		// Three window frames at 30fps is 0.1s; two laps' worth must land back inside the window.
		const advance = advanceCyclicFrame(clip, clipEntryFrame(clip), 0.2);
		expect(advance.framePosition).toBe(clip.lowFrame);
		expect(advance.departedFrames).toEqual([4, 5, 4, 5]);
	});

	it("holds the entry frame at a zero rate", () => {
		const clip = playingClip(testAnimation(5), 1, 3, 0);
		expect(advanceCyclicFrame(clip, clipEntryFrame(clip), 10)).toEqual({
			departedFrames: [],
			framePosition: 1,
		});
	});
});

describe("interpolateRigidTransform", () => {
	it("smoothly interpolates rigid translation and orientation", () => {
		const from = Mat4.identity();
		const to = createRotationMat4(new Quat(0, 0, 0, 1));
		to.m41 = 10;
		const halfway = interpolateRigidTransform(from, to, 0.5);

		expect(halfway.m41).toBe(5);
		const point = transformPoint3(halfway, new Vec3(1, 0, 0));
		expect(point.x).toBeCloseTo(5);
		expect(point.y).toBeCloseTo(1);
	});

	it("uses retail axis-angle rotation vectors", () => {
		const quarterTurn = createRotationMat4(
			rotationVectorQuaternion(new Vec3(0, 0, Math.PI / 2)),
		);
		expect(transformPoint3(quarterTurn, new Vec3(1, 0, 0))).toEqual(
			expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(1) }),
		);
	});

	it("retains sub-retail-epsilon deltas for smooth visual interpolation", () => {
		expect(rotationVectorQuaternion(new Vec3(0, 0, 0.0001))).not.toEqual(
			Quat.identity(),
		);
	});
});

describe("sampleAnimationPose", () => {
	it("interpolates within the clip and holds the terminal pose across the cyclic seam", () => {
		const clip = wholeAnimationClip(testAnimation(3));

		expect(sampleAnimationPose(clip, 0.5)[0]?.m41).toBe(5);
		expect(sampleAnimationPose(clip, 2.5)[0]?.m41).toBe(20);
	});

	it("holds the window's own high frame rather than the animation's last frame", () => {
		const clip = playingClip(testAnimation(10), 2, 4, 30);

		expect(sampleAnimationPose(clip, 3.5)[0]?.m41).toBe(35);
		// Frame 5 exists in the animation and is outside the window, so the seam holds frame 4.
		expect(sampleAnimationPose(clip, 4.5)[0]?.m41).toBe(40);
	});

	it("ignores authored root position frames while articulated playback continues", () => {
		const first = Mat4.identity();
		const second = Mat4.identity();
		second.m41 = 10;
		const third = Mat4.identity();
		third.m41 = 20;
		const withoutRootFrames: PreparedAnimation = {
			frameCount: 3,
			framesPerSecond: 30,
			hooks: [],
			id: "0x03000001",
			partCount: 1,
			partFrames: [first, second, third],
			positionFrames: [],
		};
		// Non-identity root translation and rotation per frame, mirroring a WCID 36449-style clip.
		const halfAngle = Math.PI / 6;
		const rootRotation = createRotationMat4(
			new Quat(Math.cos(halfAngle), 0, 0, Math.sin(halfAngle)),
		);
		rootRotation.m41 = 7;
		rootRotation.m42 = -3;
		const withRootFrames: PreparedAnimation = {
			...withoutRootFrames,
			positionFrames: [rootRotation, rootRotation, rootRotation],
		};

		for (const framePosition of [0, 0.5, 1.25, 2.5]) {
			expect(
				sampleAnimationPose(wholeAnimationClip(withRootFrames), framePosition),
			).toEqual(
				sampleAnimationPose(
					wholeAnimationClip(withoutRootFrames),
					framePosition,
				),
			);
		}
	});
});
