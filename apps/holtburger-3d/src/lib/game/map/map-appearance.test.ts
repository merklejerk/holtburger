import { describe, expect, it } from "vitest";
import {
	MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT,
	MAP_CONTOUR_HEIGHT_SPAN,
	MAP_FLOOR_TINT_SPAN,
	mapElevationBrightness,
} from "./map-appearance";

describe("map elevation appearance", () => {
	it("brightens above, darkens below, and clamps at the environment elevation span", () => {
		const maximum = MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT;

		expect(mapElevationBrightness(0, "outdoor")).toBe(1);
		expect(mapElevationBrightness(MAP_CONTOUR_HEIGHT_SPAN, "outdoor")).toBe(
			1 + maximum,
		);
		expect(mapElevationBrightness(-MAP_CONTOUR_HEIGHT_SPAN, "outdoor")).toBe(
			1 - maximum,
		);
		expect(mapElevationBrightness(MAP_FLOOR_TINT_SPAN, "indoor")).toBe(
			1 + maximum,
		);
		expect(
			mapElevationBrightness(MAP_CONTOUR_HEIGHT_SPAN * 10, "outdoor"),
		).toBe(1 + maximum);
	});
});
