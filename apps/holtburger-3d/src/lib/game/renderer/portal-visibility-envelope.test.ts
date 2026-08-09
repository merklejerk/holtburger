import { describe, expect, it } from "vitest";
import { findPortalFrameDivergence } from "./portal-abstract-executor";
import {
	enumeratePortalModelCorpus,
	generateSeededPortalModelScenes,
} from "./portal-model-enumerator";
import {
	alphaBlendedFragment,
	opaqueFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { composePortalReferenceFrame } from "./portal-reference-compositor";
import {
	composePortalDeferredFromEnvelopes,
	createPortalScopeVisibilityEnvelopes,
} from "./portal-visibility-envelope";

describe("portal scope visibility envelopes", () => {
	it("reduces every bounded path set without changing deferred composition", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const scene of corpus.scenes) {
			const reference = composePortalReferenceFrame(scene);
			const envelopes = createPortalScopeVisibilityEnvelopes(scene, reference);
			const actual = composePortalDeferredFromEnvelopes(
				scene,
				reference,
				envelopes,
			);
			const divergence = findPortalFrameDivergence(reference.pixels, actual);
			if (divergence) {
				throw new Error(
					`Visibility envelope diverged: ${JSON.stringify({ divergence, scene })}`,
				);
			}
		}
	});

	it("uses the farthest exit across repeated scope appearances", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "outdoor",
					fragments: [
						alphaBlendedFragment("before-first-door", 1),
						alphaBlendedFragment("visible-after-return", 5),
						opaqueFragment("exterior", 8),
					],
					scope: "outside",
				},
				{ domain: "inside", fragments: [], scope: "inside" },
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);
		const reference = composePortalReferenceFrame(scene);
		const envelopes = createPortalScopeVisibilityEnvelopes(scene, reference);
		const outside = envelopes.find(({ scopeId }) => scopeId === "outside");

		expect(outside?.maximumExitDepthByPixel).toEqual([null]);
		expect(
			composePortalDeferredFromEnvelopes(
				scene,
				reference,
				envelopes,
			)[0]?.alphaBlended.map(({ fragmentId }) => fragmentId),
		).toEqual(["visible-after-return", "before-first-door"]);
	});

	it("preserves deferred results in the larger seeded corpus", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0x5eedcafe,
		});
		for (const scene of scenes) {
			const reference = composePortalReferenceFrame(scene);
			const actual = composePortalDeferredFromEnvelopes(
				scene,
				reference,
				createPortalScopeVisibilityEnvelopes(scene, reference),
			);
			expect(findPortalFrameDivergence(reference.pixels, actual)).toBeNull();
		}
	});
});
