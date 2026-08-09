import { describe, expect, it } from "vitest";
import {
	opaqueFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { createPortalPotentialViewPlan } from "./portal-potential-view-plan";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

describe("portal potential view planning", () => {
	it("retains GPU-rejected child work in the symbolic cost plan", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("wall", 1)],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaqueFragment("child", 3)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);

		expect(composePortalReferenceFrame(scene).views).toHaveLength(1);
		expect(createPortalPotentialViewPlan(scene).views).toHaveLength(2);
	});

	it("branches across overlapping potential portals while the oracle chooses one ray", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{ domain: "near", fragments: [], scope: "near" },
				{ domain: "far", fragments: [], scope: "far" },
			],
			[
				{ depth: 2, id: "near-door", source: "root", target: "near" },
				{ depth: 4, id: "far-door", source: "root", target: "far" },
			],
		);

		expect(composePortalReferenceFrame(scene).views).toHaveLength(2);
		expect(createPortalPotentialViewPlan(scene).views).toHaveLength(3);
	});
});
