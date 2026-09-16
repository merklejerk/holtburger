import { HUMANOID_BODY_LAYOUT } from "./humanoid-body-layout";
import { describe, expect, it } from "vitest";
import {
	createRotationMat4,
	multiplyMat4,
	transformPoint3,
} from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import { composeHumanoidGesturePose } from "./humanoid-gesture-pose";

/** Synthetic object-relative pose with a rotation around Z. */
function pose(x: number, y: number, angle: number): Mat4 {
	const result = createRotationMat4(
		new Quat(Math.cos(angle / 2), 0, 0, Math.sin(angle / 2)),
	);
	result.m41 = x;
	result.m42 = y;
	return result;
}

function part(parts: readonly Mat4[], index: number): Mat4 {
	const result = parts[index];
	if (!result) throw new Error(`Missing fixture part ${index}.`);
	return result;
}

function body(pelvis: Mat4, chest: Mat4, arm: Mat4): readonly Mat4[] {
	return HUMANOID_BODY_LAYOUT.partSources.map((_, index) =>
		index === 0 ? pelvis : index === 9 ? chest : arm,
	);
}

describe("humanoid gesture composition", () => {
	it.each([0, 0.5, 1])(
		"aligns the pelvis and carries the arm with chest weight %s",
		(weight) => {
			const gesture = body(pose(10, 0, 0), pose(10, 2, 0), pose(11, 2, 0));
			const locomotion = body(
				pose(20, 0, 0),
				pose(20, 2, Math.PI / 2),
				pose(30, 30, 0),
			);
			const result = composeHumanoidGesturePose(
				gesture,
				locomotion,
				HUMANOID_BODY_LAYOUT,
				weight,
			);
			const angle = (weight * Math.PI) / 2;
			expect(part(result, 0)).toBe(locomotion[0]);
			expect(part(result, 9).m41).toBeCloseTo(20);
			expect(part(result, 9).m42).toBeCloseTo(2);
			expect(part(result, 10).m41).toBeCloseTo(20 + Math.cos(angle));
			expect(part(result, 10).m42).toBeCloseTo(2 + Math.sin(angle));
			const chestForward = transformPoint3(part(result, 9), new Vec3(1, 0, 0));
			expect(chestForward.x).toBeCloseTo(part(result, 10).m41);
			expect(chestForward.y).toBeCloseTo(part(result, 10).m42);
			for (const index of [17, 18, 19, 20, 25, 26])
				expect(part(result, index)).toBe(part(locomotion, index));
			expect(part(gesture, 9).m41).toBe(10);
		},
	);

	it("carries the upper-body offset around a turning pelvis", () => {
		const gesture = body(pose(10, 0, 0), pose(10, 2, 0), pose(11, 2, 0));
		const locomotion = body(
			pose(20, 0, Math.PI / 2),
			pose(18, 0, Math.PI / 2),
			pose(18, 1, Math.PI / 2),
		);
		const result = composeHumanoidGesturePose(
			gesture,
			locomotion,
			HUMANOID_BODY_LAYOUT,
			0,
		);
		expect(part(result, 9).m41).toBeCloseTo(18);
		expect(part(result, 9).m42).toBeCloseTo(0);
		expect(part(result, 10).m41).toBeCloseTo(18);
		expect(part(result, 10).m42).toBeCloseTo(1);
	});
	it("removes source pelvis rotation before attaching the gesture", () => {
		const sourceRoot = pose(10, 5, Math.PI / 2);
		const gesture = body(
			sourceRoot,
			multiplyMat4(sourceRoot, pose(0, 2, 0)),
			multiplyMat4(sourceRoot, pose(1, 2, 0)),
		);
		const locomotion = body(pose(20, 0, 0), pose(20, 2, 0), pose(21, 2, 0));
		const result = composeHumanoidGesturePose(
			gesture,
			locomotion,
			HUMANOID_BODY_LAYOUT,
			0,
		);
		expect(part(result, 9).m41).toBeCloseTo(20);
		expect(part(result, 9).m42).toBeCloseTo(2);
		expect(part(result, 10).m41).toBeCloseTo(21);
		expect(part(result, 10).m42).toBeCloseTo(2);
	});

	it("rejects incomplete poses instead of silently treating them as a smaller body", () => {
		const complete = body(Mat4.identity(), Mat4.identity(), Mat4.identity());
		expect(() =>
			composeHumanoidGesturePose(
				complete.slice(1),
				complete,
				HUMANOID_BODY_LAYOUT,
				0,
			),
		).toThrow("two complete poses");
		expect(() =>
			composeHumanoidGesturePose(
				complete,
				complete.slice(1),
				HUMANOID_BODY_LAYOUT,
				0,
			),
		).toThrow("two complete poses");
	});
});
