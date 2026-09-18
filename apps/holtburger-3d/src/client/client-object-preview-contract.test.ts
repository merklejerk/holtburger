import { describe, expect, it } from "vitest";
import { decodeObjectPreviewResult } from "./client-object-preview-contract";
import fixture from "./fixtures/object-preview-wire.json";

const ready = fixture.ready;

describe("object preview wire contract", () => {
	it("preserves authored traversal and appearance facts", () => {
		for (const value of Object.values(fixture))
			expect(decodeObjectPreviewResult(value)).toEqual(value);
	});

	it("rejects stale fields and an invalid cyclic boundary", () => {
		expect(() =>
			decodeObjectPreviewResult({ ...ready, stale: true }),
		).toThrow();
		expect(() =>
			decodeObjectPreviewResult({
				...ready,
				outcome: {
					...ready.outcome,
					source: {
						...ready.outcome.source,
						pose: { ...ready.outcome.source.pose, firstCyclicClip: 1 },
					},
				},
			}),
		).toThrow("cyclic clip index");
	});
});
