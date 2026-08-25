import { describe, expect, it } from "vitest";
import {
	pointLightFalloff,
	POINT_LIGHT_FALLOFF_GLSL,
	WRAP_DISTANCE_SCALE,
	WRAP_DIVISOR,
} from "./point-light-falloff";
import { VIEWER_LIGHT } from "./viewer-light";

/** Facing the light head-on from `distance` away, with a unit normal along the delta. */
function headOn(distance: number, range: number, intensity: number): number {
	return pointLightFalloff(0, distance, 0, 0, 1, 0, range, intensity);
}

describe("pointLightFalloff", () => {
	it("gives nothing at or beyond the range boundary", () => {
		expect(headOn(10, 10, 100)).toBe(0);
		expect(headOn(11, 10, 100)).toBe(0);
		expect(headOn(9.9, 10, 100)).toBeGreaterThan(0);
	});

	it("tapers to zero as it approaches the boundary", () => {
		// The taper is what plain 1/d lacks, and why a lamp reads as a pool rather than a disc.
		expect(headOn(9.99, 10, 100)).toBeLessThan(headOn(9, 10, 100));
		expect(headOn(9, 10, 100)).toBeLessThan(headOn(5, 10, 100));
	});

	it("saturates well inside the range at authored intensities", () => {
		// Median authored outdoor light: intensity 100, falloff 6, so range 9.
		expect(headOn(5, 9, 100)).toBeGreaterThan(1);
	});

	it("reproduces retail's viewer-light reach at the midpoint of its range", () => {
		// Retail tuned intensity 2.25 against hardware 1/d, which gives 0.3 at the midpoint of a
		// 15-unit range. VIEWER_LIGHT.intensity is recalibrated so this shape matches there.
		expect(headOn(7.5, VIEWER_LIGHT.range, VIEWER_LIGHT.intensity)).toBeCloseTo(
			2.25 / 7.5,
			1,
		);
	});

	it("gives the viewer light a saturated core that tapers within its range", () => {
		expect(
			headOn(3, VIEWER_LIGHT.range, VIEWER_LIGHT.intensity),
		).toBeGreaterThan(1);
		expect(headOn(14, VIEWER_LIGHT.range, VIEWER_LIGHT.intensity)).toBeLessThan(
			0.1,
		);
	});

	it("still lights a zero normal, since the wrap term uses the unnormalized delta", () => {
		expect(pointLightFalloff(0, 3, 0, 0, 0, 0, 10, 1)).toBeGreaterThan(0);
	});

	it("gives nothing to a surface facing directly away", () => {
		expect(pointLightFalloff(0, 3, 0, 0, -1, 0, 10, 1)).toBe(0);
	});

	it("scales linearly with intensity below saturation", () => {
		expect(headOn(8, 15, 2)).toBeCloseTo(headOn(8, 15, 1) * 2);
	});
});

describe("GLSL mirror", () => {
	/**
	 * The structure is duplicated across the language boundary by necessity, but the constants
	 * must not be. If these stop appearing, the GLSL has hardcoded them and can drift.
	 */
	it("interpolates the wrap constants rather than hardcoding them", () => {
		expect(POINT_LIGHT_FALLOFF_GLSL).toContain(`${WRAP_DISTANCE_SCALE} *`);
		expect(POINT_LIGHT_FALLOFF_GLSL).toContain(`/ ${WRAP_DIVISOR}`);
	});

	it("keeps the same early-out structure as the TypeScript implementation", () => {
		expect(POINT_LIGHT_FALLOFF_GLSL).toContain("lightDistance >= range");
		expect(POINT_LIGHT_FALLOFF_GLSL).toContain("wrapped <= 0.0");
		expect(POINT_LIGHT_FALLOFF_GLSL).toContain("distanceSquared <= 1.0");
	});
});
