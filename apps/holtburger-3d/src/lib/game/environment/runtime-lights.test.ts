import { Vec3 } from "../../game/math/types";
import { sceneVec3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import {
	MAX_DYNAMIC_LIGHTS,
	type RuntimeLight,
	selectNearestLights,
} from "./runtime-lights";

const ORIGIN = { x: 0, y: 0, z: 0 };

function lightAt(x: number): RuntimeLight {
	return {
		position: sceneVec3(new Vec3(x, 0, 0)),
		color: { red: 1, green: 1, blue: 1 },
		range: 10,
		intensity: 1,
	};
}

describe("selectNearestLights", () => {
	it("keeps every light and drops none when the budget is not exceeded", () => {
		const candidates = [lightAt(5), lightAt(1)];
		const selected = selectNearestLights(candidates, ORIGIN, 4);
		expect(selected.dropped).toBe(0);
		// Under budget the input is passed through untouched, so no sort cost is paid.
		expect(selected.lights).toBe(candidates);
	});

	/** This is the property that makes a cap safe rather than arbitrary. */
	it("drops the farthest light and retains the nearest on overflow", () => {
		const selected = selectNearestLights(
			[lightAt(100), lightAt(2), lightAt(50), lightAt(1)],
			ORIGIN,
			2,
		);
		expect(selected.dropped).toBe(2);
		expect(selected.lights.map((light) => light.position.x)).toEqual([1, 2]);
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
		const selected = selectNearestLights([far, near], ORIGIN, 1);
		expect(selected.lights[0]).toBe(near);
	});

	it("selects relative to the viewpoint, not the world origin", () => {
		const selected = selectNearestLights(
			[lightAt(0), lightAt(100)],
			{ x: 99, y: 0, z: 0 },
			1,
		);
		expect(selected.lights[0]!.position.x).toBe(100);
	});

	it("handles an empty candidate list", () => {
		const selected = selectNearestLights([], ORIGIN, MAX_DYNAMIC_LIGHTS);
		expect(selected.lights).toHaveLength(0);
		expect(selected.dropped).toBe(0);
	});

	it("drops everything when the budget is zero", () => {
		const selected = selectNearestLights([lightAt(1)], ORIGIN, 0);
		expect(selected.lights).toHaveLength(0);
		expect(selected.dropped).toBe(1);
	});

	it("rejects a negative budget rather than silently clamping", () => {
		expect(() => selectNearestLights([], ORIGIN, -1)).toThrow("negative");
	});

	it("does not mutate the caller's candidate array", () => {
		const candidates = [lightAt(9), lightAt(1)];
		selectNearestLights(candidates, ORIGIN, 1);
		expect(candidates.map((light) => light.position.x)).toEqual([9, 1]);
	});
});
