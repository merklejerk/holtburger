import { describe, expect, it } from "vitest";
import { retainsRetailGeometry } from "./retail-geometry-visibility";

describe("retainsRetailGeometry", () => {
	it("always retains ordinary geometry", () => {
		expect(retainsRetailGeometry("normally-visible", false)).toBe(true);
		expect(retainsRetailGeometry("normally-visible", true)).toBe(true);
	});

	it("retains degradation-hidden geometry only for explicit debug presentation", () => {
		expect(retainsRetailGeometry("degrade-hidden", false)).toBe(false);
		expect(retainsRetailGeometry("degrade-hidden", true)).toBe(true);
	});
});
