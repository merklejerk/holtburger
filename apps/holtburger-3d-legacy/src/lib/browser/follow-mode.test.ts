import { describe, expect, it } from "vitest";
import { resolveBrowserFollowModeRebase } from "./follow-mode";

describe("browser follow mode", () => {
	it("returns a coherent anchor and rebased camera when crossing an outdoor landblock boundary", () => {
		const rebase = resolveBrowserFollowModeRebase({
			cameraPosition: [193, 8, -5],
			domains: ["terrain"],
			enabled: true,
			lod: { terrain: 1 },
			submittedLocation: {
				kind: "outdoor-landblock",
				label: "Outdoor landblock 0xda55ffff",
				landblockId: 0xda55ffff,
			},
		});

		expect(rebase).toEqual({
			cameraPosition: [1, 8, -5],
			sceneInterest: {
				anchorLandblockId: 0xdb55ffff,
				domains: ["terrain"],
				kind: "outdoor-anchor",
				lod: { terrain: 1 },
				source: "follow",
			},
			submittedLocation: {
				kind: "outdoor-landblock",
				label: "Outdoor landblock 0xdb55ffff",
				landblockId: 0xdb55ffff,
			},
		});
	});
});
