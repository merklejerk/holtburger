import { describe, expect, it } from "vitest";
import { textureScrollPhase } from "./texture-scroll-phase";

describe("textureScrollPhase", () => {
	/** Retail accumulates `rate * dt` and wraps at one; a constant rate makes that a pure product. */
	it("derives phase from the shared clock and wraps into the unit interval", () => {
		expect(textureScrollPhase([0.25, 0], 2)).toEqual([0.5, 0]);
		expect(textureScrollPhase([0.25, 0], 6)).toEqual([0.5, 0]);
	});

	it("wraps a negative authored rate forward rather than leaving it signed", () => {
		// The shipped cloud layers author negative x velocities, so this is the common case.
		const [x] = textureScrollPhase([-0.013, 0.013], 100);
		expect(x).toBeGreaterThanOrEqual(0);
		expect(x).toBeLessThan(1);
	});

	it("holds a zero-velocity layer at a fixed offset for any elapsed time", () => {
		expect(textureScrollPhase([0, 0], 1_000_000)).toEqual([0, 0]);
	});
});
