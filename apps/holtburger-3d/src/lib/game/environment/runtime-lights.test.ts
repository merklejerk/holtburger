import { Vec3 } from "../../game/math/types";
import { sceneVec3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import {
	MAX_DYNAMIC_LIGHTS,
	type RuntimeLight,
	fitLightsToBudget,
} from "./runtime-lights";

/** Camera at the scene origin, so a light's distance is just its coordinate. */
const CAMERA_AT_ORIGIN = sceneVec3(Vec3.zero());

function lightAt(x: number): RuntimeLight {
	return {
		position: sceneVec3(new Vec3(x, 0, 0)),
		color: { red: 1, green: 1, blue: 1 },
		range: 10,
		intensity: 1,
	};
}

describe("fitLightsToBudget", () => {
	it("keeps every light and drops none when the budget is not exceeded", () => {
		const candidates = [lightAt(5), lightAt(1)];
		const fitted = fitLightsToBudget(candidates, CAMERA_AT_ORIGIN, 4);
		expect(fitted.dropped).toBe(0);
		// Under budget the input is passed through untouched, so no sort cost is paid.
		expect(fitted.lights).toBe(candidates);
	});

	/** This is the property that makes a cap safe rather than arbitrary. */
	it("drops the farthest light and retains the nearest on overflow", () => {
		const fitted = fitLightsToBudget(
			[lightAt(100), lightAt(2), lightAt(50), lightAt(1)],
			CAMERA_AT_ORIGIN,
			2,
		);
		expect(fitted.dropped).toBe(2);
		expect(fitted.lights.map((light) => light.position.x)).toEqual([1, 2]);
	});

	it("ranks by true distance rather than by any single axis", () => {
		const near: RuntimeLight = {
			...lightAt(0),
			position: sceneVec3(new Vec3(3, 0, 0)),
		};
		const far: RuntimeLight = {
			...lightAt(0),
			position: sceneVec3(new Vec3(0, 4, 4)),
		};
		const fitted = fitLightsToBudget([far, near], CAMERA_AT_ORIGIN, 1);
		expect(fitted.lights[0]).toBe(near);
	});

	it("ranks from the camera rather than from the world origin", () => {
		const fitted = fitLightsToBudget(
			[lightAt(0), lightAt(100)],
			sceneVec3(new Vec3(99, 0, 0)),
			1,
		);
		expect(fitted.lights[0]!.position.x).toBe(100);
	});

	it("handles an empty candidate list", () => {
		const fitted = fitLightsToBudget([], CAMERA_AT_ORIGIN, MAX_DYNAMIC_LIGHTS);
		expect(fitted.lights).toHaveLength(0);
		expect(fitted.dropped).toBe(0);
	});

	it("drops everything when the budget is zero", () => {
		const fitted = fitLightsToBudget([lightAt(1)], CAMERA_AT_ORIGIN, 0);
		expect(fitted.lights).toHaveLength(0);
		expect(fitted.dropped).toBe(1);
	});

	it("rejects a negative budget rather than silently clamping", () => {
		expect(() => fitLightsToBudget([], CAMERA_AT_ORIGIN, -1)).toThrow(
			"negative",
		);
	});

	it("does not mutate the caller's candidate array", () => {
		const candidates = [lightAt(9), lightAt(1)];
		fitLightsToBudget(candidates, CAMERA_AT_ORIGIN, 1);
		expect(candidates.map((light) => light.position.x)).toEqual([9, 1]);
	});
});
