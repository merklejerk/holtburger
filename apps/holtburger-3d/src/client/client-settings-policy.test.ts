import { describe, expect, it } from "vitest";
import { SHARED_FRAME_SETTINGS } from "../lib/frontend-frame-settings";
import { retainNearestNameplates } from "../lib/game/renderer/nameplate-selection";
import {
	CLIENT_GRAPHICS_DEFAULTS,
	frameSettingsWithGraphics,
} from "./client-settings-policy";

describe("client nameplate preference", () => {
	it("keeps hover and selection labels when disabled and restores the ambient budget", () => {
		const disabled = frameSettingsWithGraphics(SHARED_FRAME_SETTINGS, {
			...CLIENT_GRAPHICS_DEFAULTS,
			alwaysShowEntityNameplates: false,
		});
		const candidates = [
			{ identity: "ambient", distanceSquared: 1 },
			{ identity: "hovered", distanceSquared: 2, required: true },
			{ identity: "selected", distanceSquared: 3, required: true },
		];
		retainNearestNameplates(candidates, disabled.nameplates.maximumVisible);
		expect(candidates.map(({ identity }) => identity)).toEqual([
			"selected",
			"hovered",
		]);
		const enabled = frameSettingsWithGraphics(disabled, {
			...CLIENT_GRAPHICS_DEFAULTS,
			alwaysShowEntityNameplates: true,
		});
		expect(enabled.nameplates).toEqual(SHARED_FRAME_SETTINGS.nameplates);
	});
});
