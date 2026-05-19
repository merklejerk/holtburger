import { describe, expect, it } from "vitest";

import {
	deriveTransitionPortalDepthBatches,
	transitionPortalDepthBatchKey,
	type TransitionPortalDepthCandidate,
} from "./transition-portal-depth-batches";
import { deriveTransitionPortalRenderLevels } from "./render-policy";

interface TestCandidate extends TransitionPortalDepthCandidate {
	id: string;
}

describe("transition portal depth batches", () => {
	it("does not reuse unrelated indoor-to-outdoor candidates at deeper odd levels", () => {
		const currentExit = createCandidate({
			id: "current-interior-exit",
			direction: "indoor-to-outdoor",
			entryEnvCellId: 0x01010010,
			requestedInteriorEnvCellIds: [0x01010010],
		});
		const farEntry = createCandidate({
			id: "far-building-entry",
			direction: "outdoor-to-indoor",
			entryEnvCellId: 0x01010020,
			requestedInteriorEnvCellIds: [0x01010020],
		});
		const unrelatedExit = createCandidate({
			id: "unrelated-interior-exit",
			direction: "indoor-to-outdoor",
			entryEnvCellId: 0x01010030,
			requestedInteriorEnvCellIds: [0x01010030],
		});

		const result = deriveTransitionPortalDepthBatches({
			levels: deriveTransitionPortalRenderLevels({
				baseScene: "interior",
				maxDepth: 3,
			}),
			baseScene: "interior",
			initialEnvCellId: 0x01010010,
			visiblePools: {
				indoorToOutdoor: [currentExit, unrelatedExit],
				outdoorToIndoor: [farEntry],
			},
		});

		expect(
			result.batches
				.get(
					transitionPortalDepthBatchKey({
						direction: "indoor-to-outdoor",
						recursionDepth: 1,
					}),
				)
				?.map((candidate) => candidate.id),
		).toEqual(["current-interior-exit"]);
		expect(
			result.batches
				.get(
					transitionPortalDepthBatchKey({
						direction: "outdoor-to-indoor",
						recursionDepth: 2,
					}),
				)
				?.map((candidate) => candidate.id),
		).toEqual(["far-building-entry"]);
		expect(
			result.batches
				.get(
					transitionPortalDepthBatchKey({
						direction: "indoor-to-outdoor",
						recursionDepth: 3,
					}),
				)
				?.map((candidate) => candidate.id),
		).toBeUndefined();
	});

	it("allows indoor-to-outdoor candidates reached by the previous outdoor-to-indoor level", () => {
		const farEntry = createCandidate({
			id: "far-building-entry",
			direction: "outdoor-to-indoor",
			entryEnvCellId: 0x01010020,
			requestedInteriorEnvCellIds: [0x01010020, 0x01010021],
		});
		const reachedExit = createCandidate({
			id: "far-building-exit",
			direction: "indoor-to-outdoor",
			entryEnvCellId: 0x01010021,
			requestedInteriorEnvCellIds: [0x01010021],
		});

		const result = deriveTransitionPortalDepthBatches({
			levels: deriveTransitionPortalRenderLevels({
				baseScene: "exterior",
				maxDepth: 2,
			}),
			baseScene: "exterior",
			initialEnvCellId: null,
			visiblePools: {
				indoorToOutdoor: [reachedExit],
				outdoorToIndoor: [farEntry],
			},
		});

		expect(
			result.batches
				.get(
					transitionPortalDepthBatchKey({
						direction: "indoor-to-outdoor",
						recursionDepth: 2,
					}),
				)
				?.map((candidate) => candidate.id),
		).toEqual(["far-building-exit"]);
	});

	it("allows an interior exit aperture whose coverage contains the camera cell", () => {
		const doorwayFrameExit = createCandidate({
			id: "doorway-frame-exit",
			direction: "indoor-to-outdoor",
			entryEnvCellId: 0x01010020,
			requestedInteriorEnvCellIds: [0x01010010, 0x01010020],
		});

		const result = deriveTransitionPortalDepthBatches({
			levels: deriveTransitionPortalRenderLevels({
				baseScene: "interior",
				maxDepth: 1,
			}),
			baseScene: "interior",
			initialEnvCellId: 0x01010010,
			visiblePools: {
				indoorToOutdoor: [doorwayFrameExit],
				outdoorToIndoor: [],
			},
		});

		expect(
			result.batches
				.get(
					transitionPortalDepthBatchKey({
						direction: "indoor-to-outdoor",
						recursionDepth: 1,
					}),
				)
				?.map((candidate) => candidate.id),
		).toEqual(["doorway-frame-exit"]);
	});
});

function createCandidate(candidate: TestCandidate): TestCandidate {
	return candidate;
}
