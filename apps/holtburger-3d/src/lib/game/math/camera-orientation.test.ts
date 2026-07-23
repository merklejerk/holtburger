import { describe, expect, it } from "vitest";
import {
	createCameraAxesRadians,
	createCameraRotation,
	createCameraRotationRadians,
} from "./camera-orientation";
import { createViewMat4, transformPoint3 } from "./matrices";
import { Vec3 } from "./types";

describe("camera orientation", () => {
	it("returns identity at zero yaw and pitch", () => {
		expect(createCameraRotation(0, 0)).toEqual({
			w: 1,
			x: 0,
			y: 0,
			z: 0,
		});
	});

	it("matches degree and radian inputs and rejects non-finite values", () => {
		expect(createCameraRotation(90, -45)).toEqual(
			createCameraRotationRadians(Math.PI / 2, -Math.PI / 4),
		);
		expect(() => createCameraRotationRadians(Number.NaN, 0)).toThrow(
			"must be finite",
		);
	});

	it("uses the same forward axis for legacy controls and renderer view", () => {
		for (const [yaw, pitch] of [
			[0, 0],
			[Math.PI / 2, 0],
			[-Math.PI / 4, -0.45],
		] as const) {
			const axes = createCameraAxesRadians(yaw, pitch);
			const rendered = transformPoint3(
				createViewMat4(Vec3.zero(), createCameraRotationRadians(yaw, pitch)),
				axes.forward,
			);

			expect(rendered.x).toBeCloseTo(0);
			expect(rendered.y).toBeCloseTo(0);
			expect(rendered.z).toBeCloseTo(-1);
		}
	});
});
