import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import {
	MAXIMUM_RENDER_SCALE,
	MINIMUM_RENDER_SCALE,
	devicePixelArea,
	isRenderScale,
	validateRenderScale,
} from "./render-scale";
import {
	retainsProjectedObjectFootprint,
	type ObjectFootprintEnvelope,
} from "./object-footprint";

/** Identity clip leaves an envelope's own coordinates as NDC, so extents are readable. */
function envelope(
	viewportWidth: number,
	viewportHeight: number,
): ObjectFootprintEnvelope {
	return {
		bounds: new AABB3(new Vec3(-0.1, -0.1, 0.1), new Vec3(0.1, 0.1, 0.2)),
		clipFromAnchor: Mat4.identity(),
		localToLandblock: Mat4.identity(),
		landblockOffsetX: 0,
		landblockOffsetY: 0,
		landblockOffsetZ: 0,
		viewportHeight,
		viewportWidth,
	};
}

describe("render scale", () => {
	it("rejects densities outside the supported range", () => {
		expect(() =>
			validateRenderScale(MINIMUM_RENDER_SCALE, "Test"),
		).not.toThrow();
		expect(() =>
			validateRenderScale(MAXIMUM_RENDER_SCALE, "Test"),
		).not.toThrow();
		expect(() => validateRenderScale(MINIMUM_RENDER_SCALE / 2, "Test")).toThrow(
			/render scale must be within/,
		);
		expect(() => validateRenderScale(MAXIMUM_RENDER_SCALE * 2, "Test")).toThrow(
			/render scale must be within/,
		);
		expect(() => validateRenderScale(Number.NaN, "Test")).toThrow(
			/render scale must be within/,
		);
	});

	it("admits exactly the densities validation accepts", () => {
		// The predicate exists so a frontend can filter its presets; it must not drift from the
		// throw, or a surface offers a density the next frame rejects.
		for (const scale of [MINIMUM_RENDER_SCALE, 1, MAXIMUM_RENDER_SCALE]) {
			expect(isRenderScale(scale)).toBe(true);
		}
		for (const scale of [
			MINIMUM_RENDER_SCALE / 2,
			MAXIMUM_RENDER_SCALE * 2,
			Number.NaN,
		]) {
			expect(isRenderScale(scale)).toBe(false);
		}
	});

	it("scales a CSS-pixel area by the square of the density", () => {
		expect(devicePixelArea(64, 1)).toBe(64);
		expect(devicePixelArea(64, 2)).toBe(256);
		expect(devicePixelArea(64, 0.5)).toBe(16);
	});

	it("keeps footprint culling identical across densities", () => {
		// The point of denominating cutoffs in CSS pixels: sampling density decides how the same
		// content is sampled, never which content survives the cutoff.
		const cssPixelArea = 64;
		for (const scale of [MINIMUM_RENDER_SCALE, 1, MAXIMUM_RENDER_SCALE]) {
			expect(
				retainsProjectedObjectFootprint(
					envelope(100 * scale, 100 * scale),
					devicePixelArea(cssPixelArea, scale),
				),
			).toBe(true);
			expect(
				retainsProjectedObjectFootprint(
					envelope(20 * scale, 20 * scale),
					devicePixelArea(cssPixelArea, scale),
				),
			).toBe(false);
		}
	});
});
