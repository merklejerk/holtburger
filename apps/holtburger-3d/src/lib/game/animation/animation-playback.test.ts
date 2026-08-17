import { describe, expect, it } from "vitest";
import { createRotationMat4, transformPoint3 } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import {
	advanceCyclicFrame,
	interpolateRigidTransform,
	rotationVectorQuaternion,
	sampleAnimationPose,
} from "./animation-playback";
import type { PreparedAnimation } from "./animation-asset-repository";

describe("advanceCyclicFrame", () => {
	it("visits forward departed frames once and excludes the terminal seam frame", () => {
		expect(advanceCyclicFrame(1.5, 4, 5, "forward")).toEqual({
			departedFrames: [1, 2, 3],
			framePosition: 0.5,
		});
	});

	it("visits reverse departed frames once and excludes the low seam frame", () => {
		expect(advanceCyclicFrame(3.5, 4, 5, "backward")).toEqual({
			departedFrames: [3, 2, 1, 4],
			framePosition: 3.5,
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
		const first = Mat4.identity();
		const second = Mat4.identity();
		second.m41 = 10;
		const terminal = Mat4.identity();
		terminal.m41 = 100;
		const animation: PreparedAnimation = {
			frameCount: 3,
			framesPerSecond: 30,
			hooks: [],
			id: "0x03000001",
			partCount: 1,
			partFrames: [first, second, terminal],
			positionFrames: [],
		};

		expect(sampleAnimationPose(animation, 0.5)[0]?.m41).toBe(5);
		expect(sampleAnimationPose(animation, 2.5)[0]?.m41).toBe(100);
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
			expect(sampleAnimationPose(withRootFrames, framePosition)).toEqual(
				sampleAnimationPose(withoutRootFrames, framePosition),
			);
		}
	});
});
