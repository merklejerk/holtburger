import { describe, expect, it } from "vitest";
import { CLIENT_TUNING } from "../client/client-tuning";
import { EXPLORER_TUNING } from "../explorer/explorer-tuning";

describe("mode frame settings", () => {
	it("hides retail-suppressed geometry in client mode and shows it in Explorer", () => {
		expect(CLIENT_TUNING.frameSettings.showRetailHiddenGeometry).toBe(false);
		expect(EXPLORER_TUNING.frameSettings.showRetailHiddenGeometry).toBe(true);
	});
});
