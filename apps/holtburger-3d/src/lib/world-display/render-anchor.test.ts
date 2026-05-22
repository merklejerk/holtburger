import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	commitRenderAnchorCandidate,
	deriveRenderAnchorCandidate,
	STANDARD_RENDER_ANCHOR_RETAIN_RADIUS,
} from "./render-anchor";

describe("render anchor policy", () => {
	it("uses the standard retain radius for browser destinations", () => {
		expect(deriveRenderAnchorCandidate(outdoorDestination(0xda55ffff))).toEqual(
			{
				anchor: { landblockId: 0xda55ffff },
				source: "browser-destination",
				retainRadius: STANDARD_RENDER_ANCHOR_RETAIN_RADIUS,
			},
		);
	});

	it("retains the current anchor while the destination stays inside radius", () => {
		const commit = commitRenderAnchorCandidate(
			{ landblockId: 0xda55ffff },
			{
				anchor: { landblockId: 0xdb55ffff },
				source: "browser-destination",
				retainRadius: 1,
			},
		);

		expect(commit).toEqual({
			anchor: { landblockId: 0xda55ffff },
			committed: false,
			source: "browser-destination",
		});
	});

	it("commits a new anchor after the destination leaves the retain radius", () => {
		const commit = commitRenderAnchorCandidate(
			{ landblockId: 0xda55ffff },
			{
				anchor: { landblockId: 0xdc55ffff },
				source: "browser-destination",
				retainRadius: 1,
			},
		);

		expect(commit).toEqual({
			anchor: { landblockId: 0xdc55ffff },
			committed: true,
			source: "browser-destination",
		});
	});

	it("clears the anchor when no destination is active", () => {
		expect(
			commitRenderAnchorCandidate({ landblockId: 0xda55ffff }, null),
		).toEqual({
			anchor: null,
			committed: true,
			source: null,
		});
	});
});

function outdoorDestination(landblockId: number): BrowserLocationSelection {
	return {
		kind: "outdoor-location",
		label: "Test destination",
		northSouth: 0,
		northSouthHemisphere: "N",
		eastWest: 0,
		eastWestHemisphere: "E",
		elevation: 0,
		source: "manual",
		landblockId,
	};
}
