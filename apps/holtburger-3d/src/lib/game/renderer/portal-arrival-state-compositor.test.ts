import { describe, expect, it } from "vitest";
import { findPortalFrameDivergence } from "./portal-abstract-executor";
import {
	cullPortalScopesConservatively,
	executePortalArrivalStateCompositor,
	executePortalArrivalStateCompositorThroughPathDepth,
	portalCullingContainsArrivalStates,
} from "./portal-arrival-state-compositor";
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

describe("portal arrival-state compositor", () => {
	it("matches the independent oracle over the complete bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const scene of corpus.scenes) assertEquivalent(scene);
	});

	it("publishes the maximum operation ledger over the complete bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		const maximum = {
			arrivalStateCount: 0,
			arrivalStatePixelAdmissionCount: 0,
			deferredFragmentTestCount: 0,
			maskUnionCount: 0,
			opaqueFragmentTestCount: 0,
			scopeEnvelopePixelReductionCount: 0,
			statePixelVisitCount: 0,
			transitionCrossingTestCount: 0,
		};
		for (const scene of corpus.scenes) {
			const diagnostics =
				executePortalArrivalStateCompositor(scene).diagnostics;
			for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) {
				maximum[key] = Math.max(maximum[key], diagnostics[key]);
			}
		}

		expect(maximum).toEqual({
			arrivalStateCount: 4,
			arrivalStatePixelAdmissionCount: 4,
			deferredFragmentTestCount: 3,
			maskUnionCount: 3,
			opaqueFragmentTestCount: 3,
			scopeEnvelopePixelReductionCount: 4,
			statePixelVisitCount: 4,
			transitionCrossingTestCount: 5,
		});
	});

	it("matches larger seeded cyclic and alternating scenes", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0xa771a1,
		});
		for (const scene of scenes) assertEquivalent(scene);
	});

	it("proves conservative scope culling contains every bounded exact arrival state", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		const seeded = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0xc011e7,
		});

		for (const scene of [...corpus.scenes, ...seeded]) {
			const culling = cullPortalScopesConservatively(scene);
			const arrival = executePortalArrivalStateCompositor(scene);
			expect(
				portalCullingContainsArrivalStates(culling, arrival),
				JSON.stringify({ arrival, culling, scene }, null, 2),
			).toBe(true);
		}
	});

	it("keeps conservative culling visibly separate from exact portal admission", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("near-wall", 4)],
					scope: "root",
				},
				{ domain: "hidden", fragments: [], scope: "hidden" },
			],
			[{ depth: 5, id: "occluded-door", source: "root", target: "hidden" }],
		);
		const culling = cullPortalScopesConservatively(scene);
		const arrival = executePortalArrivalStateCompositor(scene);

		expect(culling.coverages.map(({ scopeId }) => scopeId)).toEqual([
			"hidden",
			"root",
		]);
		expect(arrival.states.map(({ scopeId }) => scopeId)).toEqual(["root"]);
		expect(portalCullingContainsArrivalStates(culling, arrival)).toBe(true);
	});

	it("matches complete-frontier depth truncation without retaining path records", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const [sceneIndex, scene] of corpus.scenes.entries()) {
			const maximumPathDepth = sceneIndex % 4;
			const expected = composePortalReferenceFrameThroughPathDepth(
				scene,
				maximumPathDepth,
			);
			const actual = executePortalArrivalStateCompositorThroughPathDepth(
				scene,
				maximumPathDepth,
			);
			expect(
				findPortalFrameDivergence(expected.pixels, actual.pixels),
				JSON.stringify({ actual, expected, scene }, null, 2),
			).toBeNull();
			for (const state of actual.states) {
				expect(Object.hasOwn(state, "crossingIds")).toBe(false);
				expect(Object.hasOwn(state, "parentViewId")).toBe(false);
			}
		}
	});

	it("keeps distinct arrival planes until they reduce into one scope envelope", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "inside-a",
					fragments: [particleFragment("return-dust", 5, "alpha-blended")],
					scope: "a",
				},
				{ domain: "inside-b", fragments: [], scope: "b" },
				{
					domain: "inside-c",
					fragments: [opaqueFragment("deep-wall", 10)],
					scope: "c",
				},
			],
			[
				{ depth: 2, id: "a-b", source: "a", target: "b" },
				{ depth: 4, id: "b-a", source: "b", target: "a" },
				{ depth: 6, id: "a-c", source: "a", target: "c" },
			],
		);
		const actual = executePortalArrivalStateCompositor(scene);

		expect(actual.states.map(({ id }) => id)).toEqual([
			"portal-arrival:root",
			"a-b",
			"a-c",
			"b-a",
		]);
		expect(actual.states.filter(({ scopeId }) => scopeId === "a")).toHaveLength(
			2,
		);
		expect(
			actual.envelopes.filter(({ scopeId }) => scopeId === "a"),
		).toHaveLength(1);
		expect(actual.pixels[0]?.alphaBlended[0]?.fragmentId).toBe("return-dust");
		expect(actual.pixels[0]?.opaque?.fragmentId).toBe("deep-wall");
		assertEquivalent(scene);
	});

	it("submits one physical batch across disjoint scope masks", () => {
		const scene = disjointSharedBatchScene();
		const actual = executePortalArrivalStateCompositor(scene);

		expect(actual.diagnostics.arrivalStateCount).toBe(3);
		expect(actual.diagnostics.arrivalStateCount).toBeLessThanOrEqual(
			1 + scene.crossings.length,
		);
		expect(actual.diagnostics.physicalOpaqueBatchCount).toBe(1);
		expect(actual.pixels.map(({ opaque }) => opaque?.fragmentId)).toEqual([
			"left-wall",
			"right-wall",
		]);
		assertEquivalent(scene);
	});

	it("does not admit protruding child geometry through an occluded portal", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("occluder", 4)],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaqueFragment("protruding-child", 3)],
					scope: "child",
				},
			],
			[{ depth: 5, id: "hidden-door", source: "root", target: "child" }],
		);
		const actual = executePortalArrivalStateCompositor(scene);

		expect(actual.states.map(({ id }) => id)).toEqual(["portal-arrival:root"]);
		expect(actual.pixels[0]?.opaque?.fragmentId).toBe("occluder");
		assertEquivalent(scene);
	});

	it("retains retail target geometry that protrudes before its entry plane", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("root-behind", 7)],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaqueFragment("protruding-child", 1)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);
		const actual = executePortalArrivalStateCompositor(scene);

		expect(actual.pixels[0]?.opaque?.fragmentId).toBe("protruding-child");
		assertEquivalent(scene);
	});
});

function assertEquivalent(scene: PortalModelScene): void {
	const expected = composePortalReferenceFrame(scene);
	const actual = executePortalArrivalStateCompositor(scene);
	expect(
		findPortalFrameDivergence(expected.pixels, actual.pixels),
		JSON.stringify({ actual, expected, scene }, null, 2),
	).toBeNull();
}

function disjointSharedBatchScene(): PortalModelScene {
	const pixelCount = 2;
	const rootScopeId = portalModelScopeId("outside");
	const childScopeIds = [
		portalModelScopeId("left-room"),
		portalModelScopeId("right-room"),
	];
	const roomDomainId = portalModelDomainId("rooms");
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
			{ fragments: [], id: portalModelDomainId("outside") },
			{
				fragments: childScopeIds.map((scopeId, pixelValue) => ({
					batchId: portalModelBatchId("room-walls"),
					depth: portalModelDepth(5),
					id: portalModelFragmentId(
						pixelValue === 0 ? "left-wall" : "right-wall",
					),
					kind: "opaque" as const,
					pixel: portalModelPixel(pixelValue, pixelCount),
					scopeId,
					submissionId: portalModelSubmissionId(
						pixelValue === 0 ? "left-wall" : "right-wall",
					),
				})),
				id: roomDomainId,
			},
		],
		pixelCount,
		rootScopeId,
		scopes: [
			{ domainId: portalModelDomainId("outside"), id: rootScopeId },
			...childScopeIds.map((id) => ({ domainId: roomDomainId, id })),
		],
	});
}
