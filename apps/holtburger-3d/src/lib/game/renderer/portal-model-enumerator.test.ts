import { describe, expect, it } from "vitest";
import {
	executeRecursivePortalModel,
	findPortalFrameDivergence,
} from "./portal-abstract-executor";
import {
	enumeratePortalModelCorpus,
	generateSeededPortalModelScenes,
} from "./portal-model-enumerator";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

const BOUNDS = {
	maximumCrossingCount: 3,
	maximumScopeCount: 3,
} as const;

describe("portal model bounded enumeration", () => {
	it("exhausts the published CI-safe topology and fragment bound", () => {
		const corpus = enumeratePortalModelCorpus(BOUNDS);
		let maximumPathLength = 0;
		let maximumViewCount = 0;
		let maximumRaySegmentCount = 0;

		for (const scene of corpus.scenes) {
			const frame = composePortalReferenceFrame(scene);
			maximumPathLength = Math.max(
				maximumPathLength,
				frame.diagnostics.maximumPathLength,
			);
			maximumViewCount = Math.max(
				maximumViewCount,
				frame.diagnostics.viewCount,
			);
			maximumRaySegmentCount = Math.max(
				maximumRaySegmentCount,
				frame.diagnostics.raySegmentCount,
			);
		}

		expect(corpus.diagnostics).toEqual({
			domainPartitionCount: 8,
			sceneCount: 3_980,
			topologyCount: 163,
		});
		expect({
			maximumPathLength,
			maximumRaySegmentCount,
			maximumViewCount,
		}).toEqual({
			maximumPathLength: 3,
			maximumRaySegmentCount: 4,
			maximumViewCount: 4,
		});
	});

	it("rejects invalid bounds precisely", () => {
		expect(() =>
			enumeratePortalModelCorpus({
				maximumCrossingCount: 0,
				maximumScopeCount: 0,
			}),
		).toThrow("maximum scope count must be a positive integer");
	});

	it("keeps the recursive executor equivalent across the complete bounded corpus", () => {
		const corpus = enumeratePortalModelCorpus(BOUNDS);
		for (const scene of corpus.scenes) {
			const expected = composePortalReferenceFrame(scene);
			const actual = executeRecursivePortalModel(scene);
			const divergence = findPortalFrameDivergence(
				expected.pixels,
				actual.pixels,
			);
			if (divergence) {
				throw new Error(
					`Recursive executor diverged: ${JSON.stringify({ divergence, scene })}`,
				);
			}
		}
	});

	it("replays larger seeded cyclic and re-entry scenarios exactly", () => {
		const input = {
			crossingCount: 10,
			sceneCount: 128,
			scopeCount: 6,
			seed: 0x5eedcafe,
		} as const;
		const first = generateSeededPortalModelScenes(input);
		const replay = generateSeededPortalModelScenes(input);

		expect(replay).toEqual(first);
		for (const scene of first) {
			const expected = composePortalReferenceFrame(scene);
			const actual = executeRecursivePortalModel(scene);
			expect(
				findPortalFrameDivergence(expected.pixels, actual.pixels),
			).toBeNull();
		}
	});
});
