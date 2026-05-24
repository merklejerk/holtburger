import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import { deriveWorldRenderSceneContext } from "./render-scene-context";

describe("render scene context", () => {
	it("treats outdoor browser destinations as outdoor scene contexts", () => {
		expect(
			deriveWorldRenderSceneContext({
				activeRenderAnchor: { landblockId: 0xda55ffff },
				browserDestination: createOutdoorDestination(0xda55ffff),
			}),
		).toEqual({
			kind: "outdoor",
			anchorLandblockId: 0xda55ffff,
		});
	});

	it("does not infer dungeon context from linked interiors without terrain", () => {
		expect(
			deriveWorldRenderSceneContext({
				activeRenderAnchor: { landblockId: 0xda55ffff },
				browserDestination: createOutdoorDestination(0xda55ffff),
			}),
		).toEqual({
			kind: "outdoor",
			anchorLandblockId: 0xda55ffff,
		});
	});

	it("treats interior browser destinations as dungeon render contexts", () => {
		expect(
			deriveWorldRenderSceneContext({
				activeRenderAnchor: { landblockId: 0x8a04ffff },
				browserDestination: createInteriorDestination(0x8a040155),
			}),
		).toEqual({
			kind: "dungeon",
			anchorLandblockId: 0x8a04ffff,
		});
	});
});

function createOutdoorDestination(landblockId: number): BrowserLocationSelection {
	return {
		kind: "outdoor-location",
		label: "Test outdoor destination",
		northSouth: 33.5,
		northSouthHemisphere: "S",
		eastWest: 72.8,
		eastWestHemisphere: "E",
		elevation: 0,
		source: "manual",
		landblockId,
	};
}

function createInteriorDestination(envCellId: number): BrowserLocationSelection {
	return {
		kind: "interior-cell",
		label: "Test interior destination",
		source: "manual",
		envCellId,
		landblockId: (envCellId & 0xffff0000) | 0xffff,
	};
}
