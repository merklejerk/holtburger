import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	STATIC_TRANSPARENT_SORT_DISTANCE,
	STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED,
	objectBlendPolicy,
	sortTransparentStaticRanges,
} from "./object-rendering-policy";
import { createObjectFragmentShader } from "./webgl2-object-program";

describe("sortTransparentStaticRanges", () => {
	it("sorts nearby ranges back-to-front with stable equal-distance ties", () => {
		const sorted = sortTransparentStaticRanges(
			[
				entry("tie-b", 4),
				entry("near", 2),
				entry("far", 8),
				entry("tie-a", 4),
			],
			Vec3.zero(),
		);

		expect(sorted.map(({ stableId }) => stableId)).toEqual([
			"far",
			"tie-a",
			"tie-b",
			"near",
		]);
	});

	it("keeps far ranges in deterministic bake order rather than camera-sorting them", () => {
		const sorted = sortTransparentStaticRanges(
			[entry("baked-b", 40), entry("baked-a", 20)],
			Vec3.zero(),
		);

		expect(sorted.map(({ stableId }) => stableId)).toEqual([
			"baked-b",
			"baked-a",
		]);
		expect(STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED).toBe(
			STATIC_TRANSPARENT_SORT_DISTANCE * STATIC_TRANSPARENT_SORT_DISTANCE,
		);
	});

	it("preserves baked order when a range crosses the near-sort boundary", () => {
		const sorted = sortTransparentStaticRanges(
			[
				entry("far-first", STATIC_TRANSPARENT_SORT_DISTANCE + 1),
				entry("near-second", STATIC_TRANSPARENT_SORT_DISTANCE - 1),
			],
			Vec3.zero(),
		);

		expect(sorted.map(({ stableId }) => stableId)).toEqual([
			"far-first",
			"near-second",
		]);
	});
});

describe("object fragment variants", () => {
	it("omits fog uniforms and fog code from the blended program", () => {
		expect(createObjectFragmentShader(false)).not.toContain("uFogEnabled");
		expect(createObjectFragmentShader(false)).not.toContain("applyDistanceFog");
		expect(createObjectFragmentShader(true)).toContain("uFogEnabled");
	});
});

describe("objectBlendPolicy", () => {
	it("preserves retail alpha, inverse-alpha, and additive factor variants", () => {
		expect(objectBlendPolicy(0)).toEqual({ destination: "one-minus-src-alpha", source: "src-alpha" });
		expect(objectBlendPolicy(0x100)).toEqual({ destination: "one-minus-src-alpha", source: "src-alpha" });
		expect(objectBlendPolicy(0x200)).toEqual({ destination: "src-alpha", source: "one-minus-src-alpha" });
		expect(objectBlendPolicy(0x10000)).toEqual({ destination: "one", source: "one" });
		expect(objectBlendPolicy(0x10100)).toEqual({ destination: "one", source: "src-alpha" });
		expect(objectBlendPolicy(0x10200)).toEqual({ destination: "one", source: "one-minus-src-alpha" });
	});
});

function entry(stableId: string, x: number) {
	return { center: new Vec3(x, 0, 0), range: stableId, stableId };
}
