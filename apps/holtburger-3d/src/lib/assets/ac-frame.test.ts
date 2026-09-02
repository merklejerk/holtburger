import { describe, expect, it } from "vitest";
import {
	acFrameTransform,
	acRotationFromRenderTransform,
	acVector3,
	acVectorToRender,
	renderVectorToAc,
	renderQuaternionFromAcRotation,
	resolvedFrameRotationFromRenderTransform,
	rotateAcVector,
	writeRenderQuaternionFromRenderTransform,
} from "./ac-frame";

const HALF_SQRT2 = Math.SQRT1_2;

/** Quaternion `[w, x, y, z]` for a rotation about AC's up axis, which is z. */
function yawAboutAcUp(radians: number): [number, number, number, number] {
	return [Math.cos(radians / 2), 0, 0, Math.sin(radians / 2)];
}

function acRotationForYaw(radians: number, scale: [number, number, number]) {
	return acRotationFromRenderTransform(
		acFrameTransform(
			{ origin: [0, 0, 0], orientation: yawAboutAcUp(radians) },
			scale,
		),
	);
}

function expectAcVector(
	actual: readonly [number, number, number],
	expected: readonly [number, number, number],
) {
	expect(actual[0]).toBeCloseTo(expected[0], 10);
	expect(actual[1]).toBeCloseTo(expected[1], 10);
	expect(actual[2]).toBeCloseTo(expected[2], 10);
}

describe("renderVectorToAc", () => {
	it("inverts acVectorToRender", () => {
		const authored = acVector3([1, 2, 3]);
		expectAcVector(renderVectorToAc(acVectorToRender(authored)), [1, 2, 3]);
	});

	it("maps AC's up axis to the renderer's up axis and back", () => {
		// The whole point of the pair: authored (0, 0, 1) is up, and reading it as a render vector
		// would point sideways.
		expect(acVectorToRender(acVector3([0, 0, 1]))).toStrictEqual([0, 1, -0]);
		expectAcVector(renderVectorToAc([0, 1, 0] as never), [0, 0, 1]);
	});
});

describe("acRotationFromRenderTransform", () => {
	it("returns the identity for an unrotated owner", () => {
		const rotation = acRotationForYaw(0, [1, 1, 1]);
		expectAcVector(rotation.columns[0], [1, 0, 0]);
		expectAcVector(rotation.columns[1], [0, 1, 0]);
		expectAcVector(rotation.columns[2], [0, 0, 1]);
	});

	/**
	 * The defect this whole phase exists for: a quarter turn about AC's up axis must move a
	 * horizontal velocity a quarter turn *in AC's horizontal plane*, leaving up untouched. An axis
	 * swap in the conjugation would rotate about the wrong axis and tilt it instead.
	 */
	it("rotates AC's horizontal axes about AC's up axis, leaving up fixed", () => {
		const rotation = acRotationForYaw(Math.PI / 2, [1, 1, 1]);
		expectAcVector(rotation.columns[0], [0, 1, 0]);
		expectAcVector(rotation.columns[1], [-1, 0, 0]);
		expectAcVector(rotation.columns[2], [0, 0, 1]);
	});

	it("carries a partial turn rather than snapping to an axis", () => {
		const rotation = acRotationForYaw(Math.PI / 4, [1, 1, 1]);
		expectAcVector(rotation.columns[0], [HALF_SQRT2, HALF_SQRT2, 0]);
	});

	/** Retail's `Frame` has an origin and a quaternion and no scale, so a scaled owner must not
	 * scale the velocities it emits. */
	it("divides out authored scale, including non-uniform scale", () => {
		const rotation = acRotationForYaw(Math.PI / 2, [2, 3, 4]);
		expectAcVector(rotation.columns[0], [0, 1, 0]);
		expectAcVector(rotation.columns[1], [-1, 0, 0]);
		expectAcVector(rotation.columns[2], [0, 0, 1]);
	});
});

describe("rotateAcVector", () => {
	it("preserves magnitude, because a velocity is not a direction", () => {
		const rotated = rotateAcVector(
			acRotationForYaw(Math.PI / 3, [1, 1, 1]),
			acVector3([3, 4, 12]),
		);
		expect(Math.hypot(...rotated)).toBeCloseTo(13, 10);
	});

	it("turns a north-pointing velocity into a west-pointing one on a quarter turn", () => {
		// AC's +y is north. A quarter turn about up sends it to -x.
		const rotated = rotateAcVector(
			acRotationForYaw(Math.PI / 2, [1, 1, 1]),
			acVector3([0, 5, 0]),
		);
		expectAcVector(rotated, [-5, 0, 0]);
	});

	it("leaves a vertical velocity untouched by a yaw", () => {
		const rotated = rotateAcVector(
			acRotationForYaw(Math.PI / 2, [1, 1, 1]),
			acVector3([0, 0, 7]),
		);
		expectAcVector(rotated, [0, 0, 7]);
	});
});

describe("renderQuaternionFromAcRotation", () => {
	it("returns render identity for an unrotated AC frame", () => {
		expect(
			renderQuaternionFromAcRotation(acRotationForYaw(0, [1, 1, 1])),
		).toMatchObject({ w: 1, x: 0, y: 0, z: 0 });
	});

	it("converts AC yaw into rotation about render up", () => {
		const rotation = renderQuaternionFromAcRotation(
			acRotationForYaw(Math.PI / 2, [1, 1, 1]),
		);
		expect(rotation.w).toBeCloseTo(HALF_SQRT2, 10);
		expect(rotation.x).toBeCloseTo(0, 10);
		expect(rotation.y).toBeCloseTo(HALF_SQRT2, 10);
		expect(rotation.z).toBeCloseTo(0, 10);
	});
});

describe("resolved render rotation", () => {
	it("publishes matching AC and render representations after removing scale", () => {
		const resolved = resolvedFrameRotationFromRenderTransform(
			acFrameTransform(
				{
					origin: [0, 0, 0],
					orientation: yawAboutAcUp(Math.PI / 2),
				},
				[2, 3, 4],
			),
		);
		expectAcVector(resolved.ac.columns[0], [0, 1, 0]);
		expect(resolved.render.w).toBeCloseTo(HALF_SQRT2, 10);
		expect(resolved.render.y).toBeCloseTo(HALF_SQRT2, 10);
	});

	it("writes a scale-free render quaternion into caller-owned storage", () => {
		const transform = acFrameTransform(
			{
				origin: [0, 0, 0],
				orientation: yawAboutAcUp(Math.PI / 2),
			},
			[2, 3, 4],
		);
		const output = { w: 0, x: 0, y: 0, z: 0 };

		writeRenderQuaternionFromRenderTransform(transform, output);

		expect(output.w).toBeCloseTo(HALF_SQRT2, 10);
		expect(output.x).toBeCloseTo(0, 10);
		expect(output.y).toBeCloseTo(HALF_SQRT2, 10);
		expect(output.z).toBeCloseTo(0, 10);
	});
});
