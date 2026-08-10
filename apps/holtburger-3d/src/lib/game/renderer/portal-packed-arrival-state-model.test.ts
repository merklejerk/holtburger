import { describe, expect, it } from "vitest";
import { findPortalFrameDivergence } from "./portal-abstract-executor";
import {
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
} from "./portal-arrival-metadata";
import { executePortalArrivalStateCompositorThroughPathDepth } from "./portal-arrival-state-compositor";
import {
	enumeratePortalModelCorpus,
	generateSeededPortalModelScenes,
} from "./portal-model-enumerator";
import { createPortalModelScene, type PortalModelScene } from "./portal-model";
import {
	additiveFragment,
	alphaBlendedFragment,
	opaqueFragment,
	particleFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { executePackedPortalArrivalStateModel } from "./portal-packed-arrival-state-model";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import { composePortalReferenceFrameThroughPathDepth } from "./portal-reference-compositor";
import { composePortalDeferredFromEnvelopes } from "./portal-visibility-envelope";

const SEEDED_SCENE_COUNT = 128;

describe("packed portal arrival-state model", () => {
	it("matches accepted envelopes and the independent compositor over the bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus({
			maximumCrossingCount: 3,
			maximumScopeCount: 3,
		});
		for (const [sceneIndex, scene] of corpus.scenes.entries()) {
			assertEquivalent(scene, sceneIndex % 4);
			assertSelectedCrossingDepthBound(scene);
		}
	});

	it("matches seeded cycles and remains invariant under crossing storage reversal", () => {
		const scenes = generateSeededPortalModelScenes({
			crossingCount: 10,
			sceneCount: SEEDED_SCENE_COUNT,
			scopeCount: 6,
			seed: 0x51ad_e7a,
		});
		for (const scene of scenes) {
			assertEquivalent(scene, PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth);
			assertSelectedCrossingDepthBound(scene);
			assertEquivalent(
				createPortalModelScene({
					...scene,
					crossings: [...scene.crossings].reverse(),
				}),
				PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			);
		}
	});

	it("folds a newly reached terminal frontier into the final reduction command", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{
					domain: "child",
					fragments: [opaqueFragment("terminal-wall", 7)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "root-child", source: "root", target: "child" }],
		);
		const actual = executePackedPortalArrivalStateModel(scene, 1);

		expect(actual.envelopes).toEqual(
			executePortalArrivalStateCompositorThroughPathDepth(scene, 1).envelopes,
		);
		expect(actual.diagnostics).toMatchObject({
			arrivalMetadataCapacityBytes: PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
			arrivalMetadataPopulatedBytes: 2 * PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
			frontierClearCommandCount: 1,
			metadataStateWriteCount: 2,
			propagationCommandCount: 1,
			repeatedArrivalStatePixelCount: 0,
			scopeEnvelopeReductionCommandCount: 1,
			terminalDestinationPixelReductionCount: 1,
		});
	});

	it("preserves physical transparent, additive, and particle composition through envelopes", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [alphaBlendedFragment("root-glass", 1)],
					scope: "root",
				},
				{
					domain: "middle",
					fragments: [
						particleFragment("middle-smoke", 3, "alpha-blended"),
						additiveFragment("middle-glow", 4),
					],
					scope: "middle",
				},
				{
					domain: "leaf",
					fragments: [
						opaqueFragment("leaf-wall", 9),
						particleFragment("leaf-sparks", 8, "additive"),
					],
					scope: "leaf",
				},
			],
			[
				{ depth: 2, id: "root-middle", source: "root", target: "middle" },
				{ depth: 6, id: "middle-leaf", source: "middle", target: "leaf" },
			],
		);

		assertEquivalent(scene, 2);
	});
});

function assertSelectedCrossingDepthBound(scene: PortalModelScene): void {
	const policyDepth = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
	const boundedDepth = Math.min(policyDepth, scene.crossings.length);
	const full = executePackedPortalArrivalStateModel(scene, policyDepth);
	const bounded = executePackedPortalArrivalStateModel(scene, boundedDepth);
	expect(
		bounded.envelopes,
		JSON.stringify(
			{ bounded, boundedDepth, full, policyDepth, scene },
			null,
			2,
		),
	).toEqual(full.envelopes);
	expect(bounded.diagnostics.repeatedArrivalStatePixelCount).toBe(0);
}

function assertEquivalent(
	scene: PortalModelScene,
	maximumPathDepth: number,
): void {
	const accepted = executePortalArrivalStateCompositorThroughPathDepth(
		scene,
		maximumPathDepth,
	);
	const packed = executePackedPortalArrivalStateModel(scene, maximumPathDepth);
	expect(
		packed.envelopes,
		JSON.stringify({ accepted: accepted.envelopes, packed, scene }, null, 2),
	).toEqual(accepted.envelopes);
	expect(packed.diagnostics.repeatedArrivalStatePixelCount).toBe(0);
	const reference = composePortalReferenceFrameThroughPathDepth(
		scene,
		maximumPathDepth,
	);
	const deferred = composePortalDeferredFromEnvelopes(
		scene,
		reference,
		packed.envelopes,
	);
	expect(
		findPortalFrameDivergence(reference.pixels, deferred),
		JSON.stringify({ deferred, packed, reference, scene }, null, 2),
	).toBeNull();
}
