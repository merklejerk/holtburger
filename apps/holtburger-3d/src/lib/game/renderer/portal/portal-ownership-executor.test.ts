import { describe, expect, it } from "vitest";
import {
	allocatePortalViewLabels,
	executePortalDepthLabels,
	executePortalViewLabels,
	planPortalOwnershipWithinBudget,
} from "./portal-ownership-executor";
import {
	enumeratePortalModelCorpus,
	generateSeededPortalModelScenes,
} from "./portal-model-enumerator";
import {
	opaqueFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { createPortalPotentialViewPlan } from "./portal-potential-view-plan";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

const DEPTH_LABELS = [17, 203, 4, 99, 31, 240, 8, 55, 144, 2, 111] as const;

describe("portal view-label execution", () => {
	it("matches oracle opaque ownership over the complete bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const scene of corpus.scenes) assertOpaqueEquivalent(scene);
	});

	it("matches larger seeded cyclic and alternating paths", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0x5eedcafe,
		});
		for (const scene of scenes) assertOpaqueEquivalent(scene);
	});

	it("is invariant under arbitrary view-label alpha-renaming", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "outside",
					fragments: [opaqueFragment("outside", 8)],
					scope: "outside",
				},
				{ domain: "inside", fragments: [], scope: "inside" },
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);
		const plan = createPortalPotentialViewPlan(scene);
		const left = executePortalViewLabels(scene, {
			labelsByViewId: new Map(
				plan.views.map((view, index) => [view.id, index]),
			),
			plan,
		});
		const renamedLabels = [91, 7, 203] as const;
		const right = executePortalViewLabels(scene, {
			labelsByViewId: new Map(
				plan.views.map((view, index) => [view.id, renamedLabels[index]!]),
			),
			plan,
		});

		expect(
			right.pixels.map(({ opaqueFragmentId }) => opaqueFragmentId),
		).toEqual(left.pixels.map(({ opaqueFragmentId }) => opaqueFragmentId));
	});

	it("rejects a grandchild whose overlapping sibling parent lost ownership", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("root-wall", 22)],
					scope: "root",
				},
				{
					domain: "far",
					fragments: [opaqueFragment("far-wall", 25)],
					scope: "far",
				},
				{
					domain: "near",
					fragments: [opaqueFragment("near-wall", 28)],
					scope: "near",
				},
			],
			[
				{ depth: 8, id: "far-door", source: "root", target: "far" },
				{ depth: 4, id: "near-door", source: "root", target: "near" },
				{ depth: 12, id: "far-return", source: "far", target: "root" },
			],
		);

		const depthOnly = executePortalDepthLabels(scene, {
			labelsByPathDepth: DEPTH_LABELS,
		});
		const plan = createPortalPotentialViewPlan(scene);
		const viewOwned = executePortalViewLabels(scene, {
			labelsByViewId: allocatePortalViewLabels(plan),
			plan,
		});

		expect(depthOnly.pixels[0]?.opaqueFragmentId).toBe("root-wall");
		expect(viewOwned.pixels[0]?.opaqueFragmentId).toBe("near-wall");
	});

	it.each([
		{
			budget: {
				maximumOwnershipLabelCount: 257,
				maximumPathDepth: 1,
				maximumPotentialViewCount: 1,
			},
			error: "ownership-label budget",
		},
		{
			budget: {
				maximumOwnershipLabelCount: 1,
				maximumPathDepth: -1,
				maximumPotentialViewCount: 1,
			},
			error: "path-depth budget",
		},
		{
			budget: {
				maximumOwnershipLabelCount: 1,
				maximumPathDepth: 1,
				maximumPotentialViewCount: 0,
			},
			error: "potential-view budget",
		},
	])("rejects an invalid $error", ({ budget, error }) => {
		const scene = portalModelTestScene(
			[{ domain: "root", fragments: [], scope: "root" }],
			[],
		);
		expect(() =>
			planPortalOwnershipWithinBudget(
				createPortalPotentialViewPlan(scene),
				budget,
			),
		).toThrow(error);
	});
});

function assertOpaqueEquivalent(
	scene: Parameters<typeof composePortalReferenceFrame>[0],
): void {
	const expected = composePortalReferenceFrame(scene);
	const plan = createPortalPotentialViewPlan(scene);
	const actual = executePortalViewLabels(scene, {
		labelsByViewId: allocatePortalViewLabels(plan),
		plan,
	});
	const expectedOpaque = expected.pixels.map(
		({ opaque }) => opaque?.fragmentId ?? null,
	);
	const actualOpaque = actual.pixels.map(
		({ opaqueFragmentId }) => opaqueFragmentId,
	);
	expect(
		actualOpaque,
		JSON.stringify({ actual, expected, scene }, null, 2),
	).toEqual(expectedOpaque);
}
