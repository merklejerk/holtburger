import { describe, expect, it } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../frontend-frame-settings";
import {
	NAMEPLATE_CATEGORIES,
	resolveNameplateCategory,
	validateNameplateSettings,
} from "./nameplate-policy";

const SETTINGS = SHARED_FRAME_SETTINGS.nameplates;

describe("nameplate frame policy", () => {
	it("keeps shared category visibility and color policy exhaustive", () => {
		expect(Object.keys(SETTINGS.categoryVisibility).sort()).toEqual(
			[...NAMEPLATE_CATEGORIES].sort(),
		);
		expect(Object.keys(SETTINGS.appearance.fillColors).sort()).toEqual(
			[...NAMEPLATE_CATEGORIES].sort(),
		);
		expect(() => validateNameplateSettings(SETTINGS)).not.toThrow();
	});

	it("shows portals by default", () => {
		expect(SETTINGS.categoryVisibility.portal).toBe(true);
	});

	it("classifies only the driven player as self", () => {
		expect(resolveNameplateCategory("player", "local", "local")).toBe(
			"selfPlayer",
		);
		expect(resolveNameplateCategory("player", "remote", "local")).toBe(
			"player",
		);
		expect(resolveNameplateCategory("mob", "local", "local")).toBe("mob");
	});

	it("rejects each malformed budget domain", () => {
		for (const maximumVisible of [-1, 1.5, Number.POSITIVE_INFINITY]) {
			expect(() =>
				validateNameplateSettings({
					...SETTINGS,
					maximumVisible,
				}),
			).toThrow("nonnegative safe integer");
		}
	});

	it("rejects nonpositive legibility thresholds", () => {
		for (const minimumLegibleNamePixels of [0, -1, Number.NaN]) {
			expect(() =>
				validateNameplateSettings({
					...SETTINGS,
					minimumLegibleNamePixels,
				}),
			).toThrow("finite and positive");
		}
	});

	it("rejects malformed world-space layout values", () => {
		expect(() =>
			validateNameplateSettings({
				...SETTINGS,
				anchorPaddingWorldUnits: -1,
			}),
		).toThrow("anchor padding");
		expect(() =>
			validateNameplateSettings({
				...SETTINGS,
				referenceDistance: 0,
			}),
		).toThrow("referenceDistance");
	});

	it("rejects malformed typography before Canvas receives it", () => {
		expect(() =>
			validateNameplateSettings({
				...SETTINGS,
				appearance: {
					...SETTINGS.appearance,
					name: { ...SETTINGS.appearance.name, fontSizePixels: 0 },
				},
			}),
		).toThrow("name font size");
	});

	it("rejects color channels outside the normalized domain", () => {
		expect(() =>
			validateNameplateSettings({
				...SETTINGS,
				appearance: {
					...SETTINGS.appearance,
					outlineColor: { ...SETTINGS.appearance.outlineColor, alpha: 2 },
				},
			}),
		).toThrow("outline color alpha");
	});
});
