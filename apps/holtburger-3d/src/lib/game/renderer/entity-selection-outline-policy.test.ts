import { describe, expect, it } from "vitest";

import { validateEntitySelectionOutlineSettings } from "./entity-selection-outline-policy";

describe("entity selection outline policy", () => {
	it("accepts finite normalized color channels and a positive CSS width", () => {
		expect(() =>
			validateEntitySelectionOutlineSettings({
				color: { red: 1, green: 0.5, blue: 0, alpha: 0.75 },
				widthCssPixels: 2,
			}),
		).not.toThrow();
	});

	it.each([-0.1, 1.1, Number.NaN])(
		"rejects malformed color channel %s",
		(red) => {
			expect(() =>
				validateEntitySelectionOutlineSettings({
					color: { red, green: 0.5, blue: 0, alpha: 1 },
					widthCssPixels: 2,
				}),
			).toThrow(
				"Entity-selection outline color channels must be finite and in [0, 1].",
			);
		},
	);

	it.each([0, -1, Number.NaN])(
		"rejects malformed width %s",
		(widthCssPixels) => {
			expect(() =>
				validateEntitySelectionOutlineSettings({
					color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
					widthCssPixels,
				}),
			).toThrow("Entity-selection outline width must be finite and positive.");
		},
	);
});
