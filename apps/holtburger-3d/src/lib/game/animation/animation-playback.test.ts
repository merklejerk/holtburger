import { describe, expect, it } from "vitest";
import { createRotationMat4, transformPoint3 } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import {
	advancePlayingFrame,
	clipEntryFrame,
	interpolateRigidTransform,
	playingClip,
	rotationVectorQuaternion,
	sampleAnimationPose,
	sampleAuthoredRootTransform,
	wholeAnimationClip,
} from "./animation-playback";
import {
	prepareAnimation,
	type PreparedAnimation,
} from "./animation-asset-repository";

/** Frames are distinguishable by their x translation, so a sampled pose names its frame. */
function testAnimation(
	frameCount: number,
	positionFrames: readonly Mat4[] = [],
): PreparedAnimation {
	return prepareAnimation(
		{
			frameCount,
			hooks: [],
			id: "0x03000001",
			partCount: 1,
			partFrames: Array.from({ length: frameCount }, (_, frame) => {
				const pose = Mat4.identity();
				pose.m41 = frame * 10;
				return pose;
			}),
			positionFrames,
		},
		"0x03000001",
		30,
	);
}

describe("motion", () => {
	it("rejects a window that does not fit the animation it indexes", () => {
		expect(() => playingClip(testAnimation(5), 0, 5, 30, "loop")).toThrow(
			/does not fit/,
		);
		expect(() => playingClip(testAnimation(5), 3, 1, 30, "loop")).toThrow(
			/does not fit/,
		);
		expect(() => playingClip(testAnimation(5), -1, 4, 30, "loop")).toThrow(
			/does not fit/,
		);
	});

	it("enters a forward clip at its low frame and a reversed clip inside its high frame", () => {
		expect(
			clipEntryFrame(playingClip(testAnimation(5), 1, 3, 30, "loop")),
		).toBe(1);
		// Just inside the high frame, so the first departure leaves it rather than skipping it.
		const reversed = playingClip(testAnimation(5), 1, 3, -30, "loop");
		expect(clipEntryFrame(reversed)).toBeGreaterThan(3);
		expect(clipEntryFrame(reversed)).toBeLessThan(4);
	});
});

describe("advancePlayingFrame", () => {
	it("visits forward departed frames once and excludes the terminal seam frame", () => {
		const clip = wholeAnimationClip(testAnimation(5));
		expect(advancePlayingFrame(clip, 1.5, 4 / clip.framesPerSecond)).toEqual({
			departedFrames: [1, 2, 3],
			framePosition: 0.5,
		});
	});

	it("visits reverse departed frames once and excludes the low seam frame", () => {
		const clip = playingClip(testAnimation(5), 0, 4, -30, "loop");
		// Lapping re-enters just inside the high frame, so frame 4 is not departed until the
		// cursor crosses back below it.
		expect(advancePlayingFrame(clip, 3.5, 4 / 30)).toEqual({
			departedFrames: [3, 2, 1],
			framePosition: expect.closeTo(4.4998, 4),
		});
	});

	it("never leaves the authored window", () => {
		const clip = playingClip(testAnimation(10), 4, 6, 30, "loop");
		let position = clipEntryFrame(clip);
		const visited: number[] = [];
		for (let step = 0; step < 40; step += 1) {
			const advance = advancePlayingFrame(clip, position, 0.25 / 30);
			position = advance.framePosition;
			visited.push(...advance.departedFrames);
			expect(position).toBeGreaterThanOrEqual(clip.lowFrame);
			expect(position).toBeLessThan(clip.highFrame + 1);
		}
		expect(new Set(visited)).toEqual(new Set([4, 5]));
	});

	it("laps back to the entry frame instead of holding at the far bound", () => {
		const clip = playingClip(testAnimation(10), 4, 6, 30, "loop");
		// Three window frames at 30fps is 0.1s; two laps' worth must land back inside the window.
		const advance = advancePlayingFrame(clip, clipEntryFrame(clip), 0.2);
		expect(advance.framePosition).toBe(clip.lowFrame);
		expect(advance.departedFrames).toEqual([4, 5, 4, 5]);
	});

	it("holds a forward transition at its high-frame pose", () => {
		const clip = playingClip(testAnimation(10), 4, 6, 30, "hold");

		expect(advancePlayingFrame(clip, clipEntryFrame(clip), 1)).toEqual({
			departedFrames: [4, 5],
			framePosition: 6,
		});
	});

	it("holds a reversed transition at its low-frame pose", () => {
		const clip = playingClip(testAnimation(10), 4, 6, -30, "hold");

		expect(advancePlayingFrame(clip, clipEntryFrame(clip), 1)).toEqual({
			departedFrames: [6, 5],
			framePosition: 4,
		});
	});

	it("holds the entry frame at a zero rate", () => {
		const clip = playingClip(testAnimation(5), 1, 3, 0, "hold");
		expect(advancePlayingFrame(clip, clipEntryFrame(clip), 10)).toEqual({
			departedFrames: [],
			framePosition: 1,
		});
	});
});

describe("sampleAuthoredRootTransform", () => {
	/** Yaw-only root frames, the shape the one archive-wide carrier actually authors. */
	function turningRoot(frameCount: number): PreparedAnimation {
		return testAnimation(
			frameCount,
			Array.from({ length: frameCount }, (_, frame) => {
				const pose = Mat4.identity();
				// A distinguishable per-frame yaw; magnitude is irrelevant to the contract.
				pose.m11 = Math.cos(frame * 0.01);
				pose.m13 = -Math.sin(frame * 0.01);
				pose.m31 = Math.sin(frame * 0.01);
				pose.m33 = Math.cos(frame * 0.01);
				return pose;
			}),
		);
	}

	it("returns nothing for a clip that authors no root frames", () => {
		expect(
			sampleAuthoredRootTransform(wholeAnimationClip(testAnimation(3)), 0),
		).toBeNull();
	});

	it("samples the authored root of a turning clip", () => {
		const clip = wholeAnimationClip(turningRoot(4));

		const sampled = sampleAuthoredRootTransform(clip, 0);

		expect(sampled).not.toBeNull();
		expect(sampled?.m11).toBeCloseTo(1);
	});

	it("interpolates between authored root frames", () => {
		const clip = wholeAnimationClip(turningRoot(4));

		const midpoint = sampleAuthoredRootTransform(clip, 1.5);
		const lower = sampleAuthoredRootTransform(clip, 1);
		const upper = sampleAuthoredRootTransform(clip, 2);

		expect(midpoint?.m31).toBeGreaterThan(lower!.m31);
		expect(midpoint?.m31).toBeLessThan(upper!.m31);
	});

	it("refuses a translating root, which could separate a model from its collider", () => {
		const root = Mat4.identity();
		root.m41 = 1;
		const translating = testAnimation(1, [root]);

		expect(
			sampleAuthoredRootTransform(wholeAnimationClip(translating), 0),
		).toBeNull();
	});
});

describe("interpolateRigidTransform", () => {
	it("smoothly interpolates rigid translation and orientation", () => {
		const from = { rotation: Quat.identity(), translation: new Vec3(0, 0, 0) };
		const to = {
			rotation: new Quat(0, 0, 0, 1),
			translation: new Vec3(10, 0, 0),
		};
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
	it.each([new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)])(
		"preserves prepared rotation interpolation about %o",
		(axis) => {
			// Cover near-identical rotations, each matrix extraction branch, and the shortest arc
			// across the sign seam. Expected angles describe the motion, not the implementation.
			for (const [start, end, delta] of [
				[0, 0.0001, 0.0001],
				[0, Math.PI / 2, Math.PI / 2],
				[Math.PI, Math.PI, 0],
				[(-17 * Math.PI) / 18, (17 * Math.PI) / 18, -Math.PI / 9],
			] as const) {
				const rotationAt = (angle: number) =>
					createRotationMat4(
						rotationVectorQuaternion(
							new Vec3(axis.x * angle, axis.y * angle, axis.z * angle),
						),
					);
				const from = rotationAt(start);
				const to = rotationAt(end);
				from.m41 = -2;
				from.m42 = 3;
				from.m43 = 7;
				to.m41 = 6;
				to.m42 = -1;
				to.m43 = 9;
				const animation = prepareAnimation(
					{
						id: "0x03000001",
						frameCount: 2,
						partCount: 1,
						partFrames: [from, to],
						positionFrames: [],
						hooks: [],
					},
					"0x03000001",
				);
				// Shared endpoints must stay immutable across every entity and repeated sample.
				for (const frame of animation.partFrames) {
					Object.freeze(frame.rotation);
					Object.freeze(frame.translation);
				}
				for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
					const expected = rotationAt(start + delta * fraction);
					expected.m41 = -2 + 8 * fraction;
					expected.m42 = 3 - 4 * fraction;
					expected.m43 = 7 + 2 * fraction;
					const sampled = sampleAnimationPose(
						wholeAnimationClip(animation),
						fraction,
					)[0];
					if (!sampled) throw new Error("Expected a sampled part.");
					for (const point of [
						Vec3.zero(),
						new Vec3(1, 0, 0),
						new Vec3(0, 1, 0),
						new Vec3(0, 0, 1),
					]) {
						const actual = transformPoint3(sampled, point);
						const wanted = transformPoint3(expected, point);
						expect(actual.x).toBeCloseTo(wanted.x, 10);
						expect(actual.y).toBeCloseTo(wanted.y, 10);
						expect(actual.z).toBeCloseTo(wanted.z, 10);
					}
				}
			}
		},
	);

	it("keeps an explicit authored rate while interpolating at render cadence", () => {
		const clip = playingClip(testAnimation(3), 0, 2, 40, "loop");
		const halfFrame = advancePlayingFrame(
			clip,
			clipEntryFrame(clip),
			1 / 80,
		).framePosition;

		// 40 fps is the source animation's traversal rate; a half display interval still lands
		// between authored frames and uses the same sampler ordinary entities use.
		expect(halfFrame).toBeCloseTo(0.5);
		expect(sampleAnimationPose(clip, halfFrame)[0]?.m41).toBeCloseTo(5);
	});

	it("interpolates within the clip and holds the terminal pose across the cyclic seam", () => {
		const clip = wholeAnimationClip(testAnimation(3));

		expect(sampleAnimationPose(clip, 0.5)[0]?.m41).toBe(5);
		expect(sampleAnimationPose(clip, 2.5)[0]?.m41).toBe(20);
	});

	it("holds the window's own high frame rather than the animation's last frame", () => {
		const clip = playingClip(testAnimation(10), 2, 4, 30, "loop");

		expect(sampleAnimationPose(clip, 3.5)[0]?.m41).toBe(35);
		// Frame 5 exists in the animation and is outside the window, so the seam holds frame 4.
		expect(sampleAnimationPose(clip, 4.5)[0]?.m41).toBe(40);
	});

	it("ignores authored root position frames while articulated playback continues", () => {
		const withoutRootFrames = testAnimation(3);
		// Non-identity root translation and rotation per frame, mirroring a WCID 36449-style clip.
		const halfAngle = Math.PI / 6;
		const rootRotation = createRotationMat4(
			new Quat(Math.cos(halfAngle), 0, 0, Math.sin(halfAngle)),
		);
		rootRotation.m41 = 7;
		rootRotation.m42 = -3;
		const withRootFrames = testAnimation(3, [
			rootRotation,
			rootRotation,
			rootRotation,
		]);

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
