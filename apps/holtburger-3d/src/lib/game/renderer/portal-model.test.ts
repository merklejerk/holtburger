import { describe, expect, it } from "vitest";
import {
	createPortalModelAperture,
	createPortalModelFootprint,
	createPortalModelScene,
	intersectPortalModelFootprints,
	portalModelCrossingId,
	portalModelBatchId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFootprintCardinality,
	portalModelFootprintContains,
	portalModelFootprintHas,
	portalModelFootprintsOverlap,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
	portalModelSubmissionId,
	subtractPortalModelFootprints,
	unionPortalModelFootprints,
	type PortalModelScene,
} from "./portal-model";

const PIXEL_COUNT = 40;

describe("portal compositor finite model", () => {
	it("performs exact immutable footprint algebra across word boundaries", () => {
		const left = createPortalModelFootprint(PIXEL_COUNT, [0, 1, 31, 32]);
		const right = createPortalModelFootprint(PIXEL_COUNT, [1, 2, 32, 39]);
		const intersection = intersectPortalModelFootprints(left, right);
		const union = unionPortalModelFootprints(left, right);
		const difference = subtractPortalModelFootprints(left, right);

		expect(pixels(intersection)).toEqual([1, 32]);
		expect(pixels(union)).toEqual([0, 1, 2, 31, 32, 39]);
		expect(pixels(difference)).toEqual([0, 31]);
		expect(portalModelFootprintCardinality(union)).toBe(6);
		expect(portalModelFootprintContains(union, left)).toBe(true);
		expect(portalModelFootprintsOverlap(left, right)).toBe(true);
		expect(Object.isFrozen(left)).toBe(true);
		expect(Object.isFrozen(left.words)).toBe(true);
	});

	it("keeps authored scope identity separate from reusable domain identity", () => {
		const scene = validScene();

		expect(scene.scopes[0]?.domainId).toBe(scene.scopes[1]?.domainId);
		expect(scene.scopes[0]?.id).not.toBe(scene.scopes[1]?.id);
		expect(scene.domains[0]?.fragments.map(({ scopeId }) => scopeId)).toEqual([
			portalModelScopeId("root-cell"),
			portalModelScopeId("next-cell"),
		]);
		expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
		expect(Object.isFrozen(scene)).toBe(true);
		expect(Object.isFrozen(scene.domains[0]?.fragments)).toBe(true);
	});

	it("rejects malformed references with one precise failure", () => {
		const scene = validScene();
		const malformed: PortalModelScene = {
			...scene,
			scopes: [
				...scene.scopes,
				{
					domainId: portalModelDomainId("missing-domain"),
					id: portalModelScopeId("bad-cell"),
				},
			],
		};

		expect(() => createPortalModelScene(malformed)).toThrow(
			"scope bad-cell references missing domain missing-domain",
		);
	});

	it("rejects local depth ties until an explicit tie policy exists", () => {
		const scene = validScene();
		const crossing = scene.crossings[0]!;
		const tied: PortalModelScene = {
			...scene,
			crossings: [
				{
					...crossing,
					aperture: createPortalModelAperture(PIXEL_COUNT, [
						{
							depth: portalModelDepth(2),
							pixel: portalModelPixel(0, PIXEL_COUNT),
						},
					]),
				},
			],
		};

		expect(() => createPortalModelScene(tied)).toThrow(
			"depth tie at scope root-cell, pixel 0, depth 2",
		);
	});

	it("rejects inconsistent reciprocal topology", () => {
		const scene = validScene();
		const crossing = scene.crossings[0]!;
		const malformed: PortalModelScene = {
			...scene,
			crossings: [
				{
					...crossing,
					reciprocalCrossingId: portalModelCrossingId("missing-return"),
				},
			],
		};

		expect(() => createPortalModelScene(malformed)).toThrow(
			"crossing root-next references missing reciprocal missing-return",
		);
	});
});

function validScene(): PortalModelScene {
	const domainId = portalModelDomainId("indoor-island");
	const rootScopeId = portalModelScopeId("root-cell");
	const nextScopeId = portalModelScopeId("next-cell");
	return createPortalModelScene({
		crossings: [
			{
				aperture: createPortalModelAperture(PIXEL_COUNT, [
					{
						depth: portalModelDepth(3),
						pixel: portalModelPixel(0, PIXEL_COUNT),
					},
				]),
				id: portalModelCrossingId("root-next"),
				reciprocalCrossingId: null,
				relationship: "depth-continuous",
				sourceScopeId: rootScopeId,
				targetScopeId: nextScopeId,
			},
		],
		domains: [
			{
				fragments: [
					{
						batchId: portalModelBatchId("root-opaque-batch"),
						depth: portalModelDepth(2),
						id: portalModelFragmentId("root-opaque"),
						kind: "opaque",
						pixel: portalModelPixel(0, PIXEL_COUNT),
						scopeId: rootScopeId,
						submissionId: portalModelSubmissionId("root-opaque-submission"),
					},
					{
						batchId: portalModelBatchId("next-particle-batch"),
						blend: "alpha-blended",
						depth: portalModelDepth(4),
						id: portalModelFragmentId("next-particle"),
						kind: "particle",
						pixel: portalModelPixel(0, PIXEL_COUNT),
						scopeId: nextScopeId,
						submissionId: portalModelSubmissionId("next-particle-submission"),
					},
				],
				id: domainId,
			},
		],
		pixelCount: PIXEL_COUNT,
		rootScopeId,
		scopes: [
			{ domainId, id: rootScopeId },
			{ domainId, id: nextScopeId },
		],
	});
}

function pixels(
	footprint: ReturnType<typeof createPortalModelFootprint>,
): number[] {
	const result: number[] = [];
	for (let pixel = 0; pixel < footprint.pixelCount; pixel += 1) {
		if (
			portalModelFootprintHas(
				footprint,
				portalModelPixel(pixel, footprint.pixelCount),
			)
		) {
			result.push(pixel);
		}
	}
	return result;
}
