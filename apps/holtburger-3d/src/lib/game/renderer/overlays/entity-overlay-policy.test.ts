import { describe, expect, it } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../../frontend-frame-settings";
import {
	resolveAmbientEntityOverlay,
	validateEntityOverlaySettings,
	validateHealthBarSettings,
} from "./entity-overlay-policy";

const OVERLAY_SETTINGS = SHARED_FRAME_SETTINGS.entityOverlays;
const BAR_SETTINGS = SHARED_FRAME_SETTINGS.healthBars;
const NAMEPLATE_SETTINGS = SHARED_FRAME_SETTINGS.nameplates;

describe("entity overlay frame policy", () => {
	it("accepts shared entity overlay and health bar settings", () => {
		expect(() => validateEntityOverlaySettings(OVERLAY_SETTINGS)).not.toThrow();
		expect(() => validateHealthBarSettings(BAR_SETTINGS)).not.toThrow();
	});

	it("rejects malformed world-space layout values", () => {
		expect(() =>
			validateEntityOverlaySettings({
				...OVERLAY_SETTINGS,
				anchorPaddingWorldUnits: -1,
			}),
		).toThrow("anchorPaddingWorldUnits");
		expect(() =>
			validateEntityOverlaySettings({
				...OVERLAY_SETTINGS,
				referenceDistance: 0,
			}),
		).toThrow("referenceDistance");
	});

	it("rejects malformed health bar dimensions, budget, legibility, or color channels", () => {
		expect(() =>
			validateHealthBarSettings({
				...BAR_SETTINGS,
				widthCssPixels: 0,
			}),
		).toThrow("Health bar width");
		expect(() =>
			validateHealthBarSettings({
				...BAR_SETTINGS,
				borderWidthCssPixels: -1,
			}),
		).toThrow("Health bar border width");
		expect(() =>
			validateHealthBarSettings({
				...BAR_SETTINGS,
				maximumVisible: -1,
			}),
		).toThrow("maximumVisible");
		expect(() =>
			validateHealthBarSettings({
				...BAR_SETTINGS,
				minimumLegibleBarPixels: 0,
			}),
		).toThrow("minimumLegibleBarPixels");
		expect(() =>
			validateHealthBarSettings({
				...BAR_SETTINGS,
				fillColor: { ...BAR_SETTINGS.fillColor, red: 2 },
			}),
		).toThrow("Health bar fill color red");
	});

	it("resolves ambient overlay labels via category visibility and selected/hovered exceptions", () => {
		expect(
			resolveAmbientEntityOverlay({
				hasNameplate: false,
				category: "mob",
				isSelected: true,
				isHovered: false,
				nameplates: NAMEPLATE_SETTINGS,
			}),
		).toBeNull();
		expect(
			resolveAmbientEntityOverlay({
				hasNameplate: true,
				category: "mob",
				isSelected: false,
				isHovered: false,
				nameplates: {
					...NAMEPLATE_SETTINGS,
					categoryVisibility: {
						...NAMEPLATE_SETTINGS.categoryVisibility,
						mob: true,
					},
				},
			}),
		).toEqual({
			occlusion: "scene",
			nameplate: "ambient",
			healthBar: null,
		});
		expect(
			resolveAmbientEntityOverlay({
				hasNameplate: true,
				category: "mob",
				isSelected: false,
				isHovered: false,
				nameplates: {
					...NAMEPLATE_SETTINGS,
					categoryVisibility: {
						...NAMEPLATE_SETTINGS.categoryVisibility,
						mob: false,
					},
				},
			}),
		).toBeNull();
		expect(
			resolveAmbientEntityOverlay({
				hasNameplate: true,
				category: "mob",
				isSelected: true,
				isHovered: false,
				nameplates: {
					...NAMEPLATE_SETTINGS,
					categoryVisibility: {
						...NAMEPLATE_SETTINGS.categoryVisibility,
						mob: false,
					},
				},
			}),
		).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
	});
});
