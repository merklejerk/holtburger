import { describe, expect, it } from "vitest";
import {
	qualifyPortalApertureId,
	qualifyPortalCrossingId,
} from "./portal-scene-identity";

describe("portal scene identity", () => {
	it("keeps identical record-local identities distinct across landblocks", () => {
		expect(qualifyPortalCrossingId("0xda55ffff", "portal-crossing:0")).toBe(
			"portal-crossing:0xda55ffff/0",
		);
		expect(qualifyPortalCrossingId("0xda56ffff", "portal-crossing:0")).toBe(
			"portal-crossing:0xda56ffff/0",
		);
		expect(
			qualifyPortalApertureId(
				"0xda55ffff",
				"portal-aperture:building/0000/0000",
			),
		).toBe("portal-aperture:0xda55ffff/building/0000/0000");
	});
});
