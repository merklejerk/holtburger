import { describe, expect, it } from "vitest";
import {
	selectionHaloOpacity,
	validateEntitySelectionOutlineSettings,
	type EntitySelectionOutlineSettings,
} from "./entity-selection-outline-policy";

const SETTINGS: EntitySelectionOutlineSettings = {
	color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
	borderColor: { red: 0, green: 0, blue: 0, alpha: 1 },
	haloColor: { red: 1, green: 0.5, blue: 0, alpha: 0.6 },
	widthCssPixels: 2,
	borderWidthCssPixels: 1,
	haloWidthCssPixels: 3,
	breathingMinimum: 0.25,
	breathingPeriodSeconds: 4,
};
describe("entity selection outline policy", () => {
	it("accepts a steady halo and disabled optional bands", () => {
		expect(() =>
			validateEntitySelectionOutlineSettings({
				...SETTINGS,
				breathingMinimum: 1,
				borderWidthCssPixels: 0,
				haloWidthCssPixels: 0,
			}),
		).not.toThrow();
	});
	it.each(["color", "borderColor", "haloColor"] as const)(
		"validates %s channels",
		(field) => {
			expect(() =>
				validateEntitySelectionOutlineSettings({
					...SETTINGS,
					[field]: { ...SETTINGS[field], red: Number.NaN },
				}),
			).toThrow("color channels");
		},
	);
	it.each([
		["widthCssPixels", 0],
		["borderWidthCssPixels", -1],
		["haloWidthCssPixels", Number.NaN],
		["breathingMinimum", -0.1],
		["breathingMinimum", 1.1],
		["breathingPeriodSeconds", 0],
	] as const)("rejects invalid %s = %s", (field, value) => {
		expect(() =>
			validateEntitySelectionOutlineSettings({ ...SETTINGS, [field]: value }),
		).toThrow();
	});
	it("cycles between authored opacity limits and repeats", () => {
		expect(selectionHaloOpacity(SETTINGS, 0)).toBeCloseTo(
			SETTINGS.haloColor.alpha * SETTINGS.breathingMinimum,
		);
		expect(
			selectionHaloOpacity(SETTINGS, SETTINGS.breathingPeriodSeconds / 2),
		).toBeCloseTo(SETTINGS.haloColor.alpha);
		expect(
			selectionHaloOpacity(SETTINGS, SETTINGS.breathingPeriodSeconds),
		).toBeCloseTo(selectionHaloOpacity(SETTINGS, 0));
	});
	it("holds peak opacity when breathing is disabled", () => {
		expect(selectionHaloOpacity({ ...SETTINGS, breathingMinimum: 1 }, 0)).toBe(
			SETTINGS.haloColor.alpha,
		);
	});
});
