import { describe, expect, it } from "vitest";
import { nearbyFacts } from "./client-nearby.test-support";
import { clientMinimapLandmark } from "./client-minimap-policy";
import type { ClientEntityFacts } from "./client-entity-mirror";

function facts(
	category: NonNullable<ClientEntityFacts["nearby"]>["category"],
	name: string,
) {
	return {
		nearby: {
			name,
			category,
			vendor: false,
			stackCount: null,
			structure: { current: null, max: null },
		},
	};
}

describe("client minimap landmarks", () => {
	it("uses the list's exact useable category without requiring inspection or a player name", () => {
		expect(clientMinimapLandmark(facts("useable", "Lever"), null)).toBe(
			"useable",
		);
		for (const category of ["item", "container", "door", "monster"] as const)
			expect(
				clientMinimapLandmark(facts(category, "Lever"), "Player"),
			).toBeNull();
	});
	it("matches all publicly named local corpses without using merged inspection names", () => {
		const corpse = {
			...nearbyFacts(7, "Corpse of Player"),
			nearby: facts("corpse", "Corpse of Player").nearby,
		};
		expect(clientMinimapLandmark(corpse, "Player")).toBe("own-corpse");
		expect(clientMinimapLandmark(corpse, "Other Player")).toBeNull();
		expect(clientMinimapLandmark(corpse, null)).toBeNull();
		expect(
			clientMinimapLandmark(facts("item", "Corpse of Player"), "Player"),
		).toBeNull();
		expect(
			clientMinimapLandmark(facts("corpse", "Corpse of Other"), "Player"),
		).toBeNull();
	});
	it("waits for public facts", () => {
		expect(clientMinimapLandmark(undefined, "Player")).toBeNull();
		expect(clientMinimapLandmark({ nearby: null }, "Player")).toBeNull();
	});
});
