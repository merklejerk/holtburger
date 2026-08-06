import { describe, expect, it } from "vitest";
import { Mat4 } from "../math/types";
import { skyTextureOffset, skyViewMatrix } from "./webgl2-sky-pass";

describe("skyTextureOffset", () => {
	/** Retail accumulates `rate * dt` and wraps at one; a constant rate makes that a pure product. */
	it("derives phase from the shared clock and wraps into the unit interval", () => {
		expect(skyTextureOffset([0.25, 0], 2)).toEqual([0.5, 0]);
		expect(skyTextureOffset([0.25, 0], 6)).toEqual([0.5, 0]);
	});

	it("wraps a negative authored rate forward rather than leaving it signed", () => {
		// The shipped cloud layers author negative x velocities, so this is the common case.
		const [x] = skyTextureOffset([-0.013, 0.013], 100);
		expect(x).toBeGreaterThanOrEqual(0);
		expect(x).toBeLessThan(1);
	});

	it("holds a zero-velocity layer at a fixed offset for any elapsed time", () => {
		expect(skyTextureOffset([0, 0], 1_000_000)).toEqual([0, 0]);
	});
});

describe("skyViewMatrix", () => {
	/** Celestial objects sit at the viewer's origin, so the sky rotates but never translates. */
	it("removes the view translation while preserving orientation", () => {
		const view = Mat4.identity();
		view.m11 = 0;
		view.m13 = -1;
		view.m41 = 12;
		view.m42 = -34;
		view.m43 = 56;
		const result = skyViewMatrix(view, new Float32Array(16));
		expect([result[12], result[13], result[14]]).toEqual([0, 0, 0]);
		expect(result[0]).toBe(0);
		expect(result[2]).toBe(-1);
	});
});
