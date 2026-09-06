import { describe, expect, it } from "vitest";
import { hexRgb } from "../lib/frontend-color";
import { ESPRESSO_AERO } from "./themes/espresso-aero";
import { uiThemeProperties } from "./ui-theme";
import type { UiTheme } from "./ui-theme-contract";

/** Alternate test-owned configuration exercises the same recipes without a second shipped theme. */
const fixture: UiTheme = {
	...ESPRESSO_AERO,
	id: "test-steel",
	name: "Test steel",
	color: {
		...ESPRESSO_AERO.color,
		surface: hexRgb("#182b3a"),
		accent: hexRgb("#b1d9ef"),
	},
	radius: { surface: 3, control: 2 },
	material: { opacity: 0.75, blur: 5, grain: 0, gloss: 0.1, shadow: 0.3 },
};

describe("UI theme projection", () => {
	it("projects the configured roles, units, and texture-free material", () => {
		const properties = uiThemeProperties(fixture, {
			reducedTransparency: false,
		});
		for (const [role, color] of Object.entries(fixture.color))
			expect(properties[`--ui-color-${role}`]).toBe(color);
		expect(properties["--ui-radius-surface"]).toBe("3px");
		expect(properties["--ui-material-grain"]).toBe("0");
		expect(properties["--ui-material-opacity"]).toBe("0.75");
		expect(properties["--ui-backdrop"]).toBe("blur(5px)");
	});
	it("makes reduced transparency opaque and removes filtering without changing the theme", () => {
		const properties = uiThemeProperties(fixture, {
			reducedTransparency: true,
		});
		expect(properties["--ui-material-opacity"]).toBe("1");
		expect(properties["--ui-backdrop"]).toBe("none");
		expect(properties["--ui-color-surface"]).toBe(fixture.color.surface);
		expect(fixture.material.opacity).toBe(0.75);
	});
	it.each([-1, NaN, Infinity])("rejects invalid dimensions %s", (blur) => {
		expect(() =>
			uiThemeProperties(
				{
					...fixture,
					material: { ...fixture.material, blur },
				},
				{ reducedTransparency: false },
			),
		).toThrow("material.blur must be finite and nonnegative");
	});
	it("rejects strengths above one", () => {
		expect(() =>
			uiThemeProperties(
				{
					...fixture,
					material: { ...fixture.material, grain: 1.1 },
				},
				{ reducedTransparency: false },
			),
		).toThrow("material.grain must not exceed 1");
	});
	it("removes filtering when the authored blur is zero", () => {
		expect(
			uiThemeProperties(
				{
					...fixture,
					material: { ...fixture.material, blur: 0 },
				},
				{ reducedTransparency: false },
			)["--ui-backdrop"],
		).toBe("none");
	});
});
