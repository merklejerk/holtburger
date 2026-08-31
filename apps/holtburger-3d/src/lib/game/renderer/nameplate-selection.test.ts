import { describe, expect, it } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../frontend-frame-settings";
import { Mat4, Vec3 } from "../math/types";
import {
	maximumLegibleNameplateDepth,
	retainLegibleNameplates,
	retainNearestNameplates,
} from "./nameplate-selection";

describe("nameplate budget selection", () => {
	it("derives and applies the exact perspective legibility depth before budgeting", () => {
		const settings = SHARED_FRAME_SETTINGS.nameplates;
		const maximumDepth = maximumLegibleNameplateDepth(settings);
		const clipFromAnchor = Mat4.zero();
		clipFromAnchor.m34 = 1;
		const candidates = [
			{ anchor: new Vec3(0, 0, maximumDepth), identity: "threshold" },
			{ anchor: new Vec3(0, 0, maximumDepth + 0.01), identity: "tiny" },
			{ anchor: new Vec3(0, 0, -1), identity: "behind" },
		];

		retainLegibleNameplates(candidates, clipFromAnchor, settings);

		expect(candidates.map(({ identity }) => identity)).toEqual(["threshold"]);
	});

	it("retains nearest candidates in deterministic back-to-front draw order", () => {
		const candidates = [
			{ distanceSquared: 9, identity: "too-far" },
			{ distanceSquared: 4, identity: "d" },
			{ distanceSquared: 1, identity: "b" },
			{ distanceSquared: 1, identity: "a" },
		];
		retainNearestNameplates(candidates, 3);
		expect(candidates.map(({ identity }) => identity)).toEqual(["d", "b", "a"]);
	});

	it("accepts zero as a complete submission cutoff", () => {
		const candidates = [{ distanceSquared: 1, identity: "a" }];
		retainNearestNameplates(candidates, 0);
		expect(candidates).toEqual([]);
	});
});
