import { describe, expect, it } from "vitest";
import { findPortalFrameDivergence } from "./portal-abstract-executor";
import {
	enumeratePortalModelCorpus,
	generateSeededPortalModelScenes,
} from "./portal-model-enumerator";
import {
	createPortalModelAperture,
	createPortalModelScene,
	portalModelBatchId,
	portalModelCrossingId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
	portalModelSubmissionId,
	type PortalModelScene,
} from "./portal-model";
import {
	composePortalReferenceFrame,
	composePortalReferenceFrameThroughPathDepth,
} from "./portal-reference-compositor";
import {
	opaqueFragment,
	particleFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import {
	executePortalViewLabelCompositor,
	executeSelectedPortalCompositor,
} from "./portal-view-label-compositor";

describe("portal view-label compositor", () => {
	it("matches the independent oracle over the complete bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const scene of corpus.scenes) assertEquivalent(scene);
	});

	it("matches larger seeded cyclic and alternating paths", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0x5eedcafe,
		});
		for (const scene of scenes) assertEquivalent(scene);
	});

	it("matches the depth-capped oracle under constrained budgets across the bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const [sceneIndex, scene] of corpus.scenes.entries()) {
			const actual = executeSelectedPortalCompositor(scene, {
				budget: {
					maximumOwnershipLabelCount: 1 + (sceneIndex % 3),
					maximumPathDepth: sceneIndex % 4,
					maximumPotentialViewCount: 1 + (sceneIndex % 5),
				},
			});
			const expected = composePortalReferenceFrameThroughPathDepth(
				scene,
				actual.ownershipPlan.plan.maximumPathLength,
			);
			const divergence = findPortalFrameDivergence(
				expected.pixels,
				actual.pixels,
			);
			expect(
				divergence,
				JSON.stringify({ actual, expected, scene }, null, 2),
			).toBeNull();
		}
	});

	it("matches the depth-capped oracle for constrained seeded cyclic scenes", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0xb0ded123,
		});
		for (const scene of scenes) {
			const actual = executeSelectedPortalCompositor(scene, {
				budget: {
					maximumOwnershipLabelCount: 3,
					maximumPathDepth: 3,
					maximumPotentialViewCount: 8,
				},
			});
			const expected = composePortalReferenceFrameThroughPathDepth(
				scene,
				actual.ownershipPlan.plan.maximumPathLength,
			);
			expect(
				findPortalFrameDivergence(expected.pixels, actual.pixels),
				JSON.stringify({ actual, expected, scene }, null, 2),
			).toBeNull();
		}
	});

	it("stops before the complete frontier that would require 257 labels", () => {
		const scene = overlappingSiblingScene(false);

		const actual = executeSelectedPortalCompositor(scene, {
			budget: {
				maximumOwnershipLabelCount: 0x100,
				maximumPathDepth: 10,
				maximumPotentialViewCount: 1_000,
			},
		});

		expect(actual.family).toBe("bounded-view-stencil");
		expect(actual.ownershipPlan.plan.maximumPathLength).toBe(0);
		expect(actual.ownershipPlan.requiredOwnershipLabelCount).toBe(1);
		expect(actual.ownershipPlan.truncation).toEqual({
			firstOmittedPathDepth: 1,
			kind: "maximum-ownership-label-count",
			requiredOwnershipLabelCount: 257,
		});
		expect(
			findPortalFrameDivergence(
				composePortalReferenceFrameThroughPathDepth(scene, 0).pixels,
				actual.pixels,
			),
		).toBeNull();
	});

	it("finishes the retained scope when maximum path depth omits its child", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{ domain: "one", fragments: [], scope: "one" },
				{
					domain: "two",
					fragments: [
						particleFragment("dust", 8, "alpha-blended"),
						opaqueFragment("wall", 9),
					],
					scope: "two",
				},
				{
					domain: "three",
					fragments: [opaqueFragment("deep-wall", 10)],
					scope: "three",
				},
			],
			[
				{ depth: 2, id: "root-one", source: "root", target: "one" },
				{ depth: 4, id: "one-two", source: "one", target: "two" },
				{ depth: 6, id: "two-three", source: "two", target: "three" },
			],
		);
		const actual = executeSelectedPortalCompositor(scene, {
			budget: {
				maximumOwnershipLabelCount: 0x100,
				maximumPathDepth: 2,
				maximumPotentialViewCount: 100,
			},
		});

		expect(actual.ownershipPlan.truncation).toEqual({
			firstOmittedPathDepth: 3,
			kind: "maximum-path-depth",
		});
		expect(actual.pixels[0]?.opaque?.fragmentId).toBe("wall");
		expect(actual.pixels[0]?.alphaBlended[0]?.fragmentId).toBe("dust");
		expect(
			findPortalFrameDivergence(
				composePortalReferenceFrameThroughPathDepth(scene, 2).pixels,
				actual.pixels,
			),
		).toBeNull();
	});

	it("treats potential-view work as a separate whole-frontier budget", () => {
		const scene = disjointSiblingScene();
		const actual = executeSelectedPortalCompositor(scene, {
			budget: {
				maximumOwnershipLabelCount: 0x100,
				maximumPathDepth: 10,
				maximumPotentialViewCount: 2,
			},
		});

		expect(actual.ownershipPlan.truncation).toEqual({
			firstOmittedPathDepth: 1,
			kind: "maximum-potential-view-count",
			requiredPotentialViewCount: 3,
		});
		expect(actual.ownershipPlan.requiredOwnershipLabelCount).toBe(1);
		expect(
			findPortalFrameDivergence(
				composePortalReferenceFrameThroughPathDepth(scene, 0).pixels,
				actual.pixels,
			),
		).toBeNull();
	});

	it("chooses the same complete cutoff when graph storage order changes", () => {
		const budget = {
			maximumOwnershipLabelCount: 0x100,
			maximumPathDepth: 10,
			maximumPotentialViewCount: 1_000,
		} as const;
		const forward = executeSelectedPortalCompositor(
			overlappingSiblingScene(false),
			{ budget },
		);
		const reversed = executeSelectedPortalCompositor(
			overlappingSiblingScene(true),
			{ budget },
		);

		expect(reversed.ownershipPlan.truncation).toEqual(
			forward.ownershipPlan.truncation,
		);
		expect(reversed.pixels).toEqual(forward.pixels);
	});
});

function overlappingSiblingScene(reverse: boolean): PortalModelScene {
	const pixelCount = 1;
	const pixel = portalModelPixel(0, pixelCount);
	const childCount = 256;
	const childScopeIds = Array.from({ length: childCount }, (_, index) =>
		portalModelScopeId(`child-${index}`),
	);
	const rootScopeId = portalModelScopeId("root");
	const domainId = portalModelDomainId("empty");
	const crossings = childScopeIds.map((targetScopeId, index) => ({
		aperture: createPortalModelAperture(pixelCount, [
			{ depth: portalModelDepth(index + 1), pixel },
		]),
		id: portalModelCrossingId(`door-${index}`),
		junctionGroupId: null,
		reciprocalCrossingId: null,
		relationship: "depth-continuous" as const,
		sourceScopeId: rootScopeId,
		targetScopeId,
	}));
	return createPortalModelScene({
		crossings: reverse ? crossings.reverse() : crossings,
		domains: [{ fragments: [], id: domainId }],
		pixelCount,
		rootScopeId,
		scopes: [rootScopeId, ...childScopeIds].map((id) => ({
			domainId,
			id,
		})),
	});
}

function disjointSiblingScene(): PortalModelScene {
	const pixelCount = 2;
	const rootScopeId = portalModelScopeId("root");
	const childScopeIds = [
		portalModelScopeId("left"),
		portalModelScopeId("right"),
	];
	return createPortalModelScene({
		crossings: childScopeIds.map((targetScopeId, pixelValue) => ({
			aperture: createPortalModelAperture(pixelCount, [
				{
					depth: portalModelDepth(2),
					pixel: portalModelPixel(pixelValue, pixelCount),
				},
			]),
			id: portalModelCrossingId(`door-${pixelValue}`),
			junctionGroupId: null,
			reciprocalCrossingId: null,
			relationship: "indoor-boundary" as const,
			sourceScopeId: rootScopeId,
			targetScopeId,
		})),
		domains: [
			{ fragments: [], id: portalModelDomainId("root") },
			{
				fragments: childScopeIds.map((scopeId, pixelValue) => ({
					batchId: portalModelBatchId("walls"),
					depth: portalModelDepth(5),
					id: portalModelFragmentId(`wall-${pixelValue}`),
					kind: "opaque" as const,
					pixel: portalModelPixel(pixelValue, pixelCount),
					scopeId,
					submissionId: portalModelSubmissionId(`wall-${pixelValue}`),
				})),
				id: portalModelDomainId("inside"),
			},
		],
		pixelCount,
		rootScopeId,
		scopes: [
			{ domainId: portalModelDomainId("root"), id: rootScopeId },
			...childScopeIds.map((id) => ({
				domainId: portalModelDomainId("inside"),
				id,
			})),
		],
	});
}

function assertEquivalent(
	scene: Parameters<typeof composePortalReferenceFrame>[0],
): void {
	const expected = composePortalReferenceFrame(scene);
	const actual = executePortalViewLabelCompositor(scene);
	const divergence = findPortalFrameDivergence(expected.pixels, actual.pixels);
	expect(
		divergence,
		JSON.stringify({ actual, expected, scene }, null, 2),
	).toBeNull();
}
