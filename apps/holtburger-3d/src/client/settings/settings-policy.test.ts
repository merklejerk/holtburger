import { describe, expect, it } from "vitest";
import { SHARED_FRAME_SETTINGS } from "../../lib/frontend-frame-settings";
import { CLIENT_GRAPHICS_DEFAULTS } from "./settings-defaults";
import { frameSettingsWithGraphics } from "./settings-policy";

describe("client interior lighting preference", () => {
	it("passes the selected ambient level into frame settings", () => {
		const settings = frameSettingsWithGraphics(SHARED_FRAME_SETTINGS, {
			...CLIENT_GRAPHICS_DEFAULTS,
			sealedInteriorAmbientLevel: 0.65,
		});
		expect(settings.sealedInteriorAmbientLevel).toBe(0.65);
	});
});
