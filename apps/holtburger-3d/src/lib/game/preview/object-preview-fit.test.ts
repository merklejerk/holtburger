import { describe, expect, it } from "vitest";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { playingClip } from "../animation/animation-playback";
import { Mat4, Quat, Vec3 } from "../math/types";
import { composeObjectPreviewFit } from "./object-preview-fit";

const bodyFit = {
	center: new Vec3(0, 1, 0),
	supportPoints: Float32Array.of(-1, 0, -1, 1, 2, 1),
};
const itemFit = {
	center: Vec3.zero(),
	supportPoints: Float32Array.of(-0.2, 0, 0, 0.2, 1, 0),
};
const maxX = (points: Float32Array): number =>
	Math.max(...points.filter((_, index) => index % 3 === 0));

describe("equipment preview fitting", () => {
	it("combines a source-scaled parent frame with the independent holding offset and child support", () => {
		const part = Mat4.identity();
		part.m41 = 1;
		const offset = Mat4.identity();
		offset.m41 = 3;
		const result = composeObjectPreviewFit(
			{
				fit: bodyFit,
				scale: new Vec3(2, 2, 2),
				setupPose: [part],
				clips: [],
				rotatesVisualRoot: false,
			},
			[{ parentPartIndex: 0, offsetTransform: offset, fit: itemFit }],
		);
		expect(maxX(result.supportPoints)).toBeCloseTo(5.2);
		expect(result.center.x).toBeCloseTo(2.1);
	});

	it("sweeps held support through the parent's selected animation", () => {
		const animation: PreparedAnimation = {
			authoredRootTranslates: false,
			emitterInfoIds: [],
			frameCount: 2,
			framesPerSecond: 30,
			hooks: [],
			id: "0x03000001",
			partCount: 1,
			positionFrames: [],
			partFrames: [0, 4].map((x) => ({
				rotation: Quat.identity(),
				translation: new Vec3(x, 0, 0),
			})),
		};
		const result = composeObjectPreviewFit(
			{
				fit: bodyFit,
				scale: new Vec3(1, 1, 1),
				setupPose: [Mat4.identity()],
				clips: [playingClip(animation, 0, 1, 30, "loop")],
				rotatesVisualRoot: false,
			},
			[{ parentPartIndex: 0, offsetTransform: Mat4.identity(), fit: itemFit }],
		);
		expect(maxX(result.supportPoints)).toBeCloseTo(4.2);
	});
});
