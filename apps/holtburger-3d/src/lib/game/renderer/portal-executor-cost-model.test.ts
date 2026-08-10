import { describe, expect, it } from "vitest";
import {
	costPortalExecutorFamilies,
	type PortalExecutorCostCandidate,
	type PortalExecutorFamily,
} from "./portal-executor-cost-model";
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
} from "./portal-model";
import {
	alphaBlendedFragment,
	opaqueFragment,
	particleFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

describe("portal executor structural costs", () => {
	it("caches repeated exterior opaque content even with one expensive batch", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "outdoor",
					fragments: [opaqueFragment("exterior", 8)],
					scope: "outside",
				},
				{ domain: "inside", fragments: [], scope: "inside" },
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);
		const candidates = costPortalExecutorFamilies(
			scene,
			composePortalReferenceFrame(scene),
			{ exteriorDomainId: portalModelDomainId("outdoor") },
		);
		const recursive = candidate(candidates, "recursive-offscreen-atlas");
		const exteriorCache = candidate(candidates, "exterior-cache-view-stencil");

		expect(exteriorCache.cachedDomainIds).toEqual([
			portalModelDomainId("outdoor"),
		]);
		expect(recursive.cost.opaqueDrawBatchCount).toBe(2);
		expect(exteriorCache.cost.opaqueDrawBatchCount).toBe(1);
		expect(exteriorCache.cost.compositeDrawCount).toBe(2);
		expect(exteriorCache.cost.offscreenTargetCount).toBe(2);
		expect(recursive.cost.contentPreparationCount).toBe(2);
		expect(exteriorCache.cost.contentPreparationCount).toBe(2);
		expect(exteriorCache.cost.repeatedContentPreparationCount).toBe(0);
	});

	it("keeps repeated-view particle batches in one contiguous upload", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "outdoor",
					fragments: [
						alphaBlendedFragment("cloud", 0),
						particleFragment("weather", 1, "alpha-blended"),
						particleFragment("sparks", 5, "additive"),
						opaqueFragment("exterior", 7),
					],
					scope: "outside",
				},
				{
					domain: "inside",
					fragments: [alphaBlendedFragment("glass", 3)],
					scope: "inside",
				},
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);
		const candidates = costPortalExecutorFamilies(
			scene,
			composePortalReferenceFrame(scene),
			{ exteriorDomainId: portalModelDomainId("outdoor") },
		);
		const recursive = candidate(candidates, "recursive-offscreen-atlas");
		const exteriorCache = candidate(candidates, "exterior-cache-view-stencil");
		const replay = candidate(candidates, "shared-view-stencil-replay");

		expect(recursive.cost.particleUploadCount).toBe(1);
		expect(recursive.cost.particleDrawBatchCount).toBe(2);
		expect(exteriorCache.cost.particleUploadCount).toBe(1);
		expect(exteriorCache.cost.particleDrawBatchCount).toBe(2);
		expect(replay.cost.visibilityAttachmentBytes).toBe(0);
		expect(replay.cost.maskDrawCount).toBeGreaterThan(
			exteriorCache.cost.maskDrawCount,
		);
	});

	it("rejects a multi-scope exterior cache without a proved safe union", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "island", fragments: [], scope: "cell-a" },
				{ domain: "island", fragments: [], scope: "cell-b" },
				{ domain: "other", fragments: [], scope: "other" },
			],
			[
				{
					depth: 2,
					id: "a-b",
					relationship: "depth-continuous",
					source: "cell-a",
					target: "cell-b",
				},
				{ depth: 4, id: "b-other", source: "cell-b", target: "other" },
				{ depth: 6, id: "other-a", source: "other", target: "cell-a" },
			],
		);
		expect(() =>
			costPortalExecutorFamilies(scene, composePortalReferenceFrame(scene), {
				exteriorDomainId: portalModelDomainId("island"),
			}),
		).toThrow("must own exactly one scope");
	});

	it("does not generalize caching to a repeated indoor domain", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "outside", fragments: [], scope: "outside" },
				{
					domain: "inside",
					fragments: [opaqueFragment("wall", 8)],
					scope: "inside",
				},
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
				{
					depth: 6,
					id: "outside-inside-again",
					source: "outside",
					target: "inside",
				},
			],
		);
		const exteriorCache = candidate(
			costPortalExecutorFamilies(scene, composePortalReferenceFrame(scene), {
				exteriorDomainId: portalModelDomainId("outside"),
			}),
			"exterior-cache-view-stencil",
		);

		expect(exteriorCache.cachedDomainIds).toEqual([]);
	});

	it("keeps one opaque batch across disjoint sibling views in the same domain", () => {
		const pixelCount = 2;
		const sharedBatch = portalModelBatchId("indoor-shells");
		const scene = createPortalModelScene({
			crossings: [
				{
					aperture: createPortalModelAperture(pixelCount, [
						{
							depth: portalModelDepth(2),
							pixel: portalModelPixel(0, pixelCount),
						},
					]),
					id: portalModelCrossingId("left-door"),
					reciprocalCrossingId: null,
					relationship: "indoor-boundary",
					sourceScopeId: portalModelScopeId("root"),
					targetScopeId: portalModelScopeId("left"),
				},
				{
					aperture: createPortalModelAperture(pixelCount, [
						{
							depth: portalModelDepth(2),
							pixel: portalModelPixel(1, pixelCount),
						},
					]),
					id: portalModelCrossingId("right-door"),
					reciprocalCrossingId: null,
					relationship: "indoor-boundary",
					sourceScopeId: portalModelScopeId("root"),
					targetScopeId: portalModelScopeId("right"),
				},
			],
			domains: [
				{ fragments: [], id: portalModelDomainId("root") },
				{
					fragments: [0, 1].map((pixel) => ({
						batchId: sharedBatch,
						depth: portalModelDepth(6),
						id: portalModelFragmentId(`wall-${pixel}`),
						kind: "opaque" as const,
						pixel: portalModelPixel(pixel, pixelCount),
						scopeId: portalModelScopeId(pixel === 0 ? "left" : "right"),
						submissionId: portalModelSubmissionId(`wall-${pixel}`),
					})),
					id: portalModelDomainId("indoors"),
				},
			],
			pixelCount,
			rootScopeId: portalModelScopeId("root"),
			scopes: [
				{
					domainId: portalModelDomainId("root"),
					id: portalModelScopeId("root"),
				},
				{
					domainId: portalModelDomainId("indoors"),
					id: portalModelScopeId("left"),
				},
				{
					domainId: portalModelDomainId("indoors"),
					id: portalModelScopeId("right"),
				},
			],
		});
		const candidates = costPortalExecutorFamilies(
			scene,
			composePortalReferenceFrame(scene),
			{ exteriorDomainId: null },
		);
		const shared = candidate(candidates, "shared-view-stencil-replay");
		const exteriorCache = candidate(candidates, "exterior-cache-view-stencil");

		expect(shared.cost.ownershipLabelCount).toBe(2);
		expect(shared.cost.opaqueDrawBatchCount).toBe(1);
		expect(exteriorCache.cost.opaqueDrawBatchCount).toBe(1);
	});
});

function candidate(
	candidates: readonly PortalExecutorCostCandidate[],
	family: PortalExecutorFamily,
): PortalExecutorCostCandidate {
	const result = candidates.find((candidate) => candidate.family === family);
	if (!result) throw new Error(`Missing portal executor candidate ${family}.`);
	return result;
}
