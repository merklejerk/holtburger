import { describe, expect, it } from "vitest";
import {
	decodeObjectPreviewResult,
	objectPreviewSourceForRendering,
} from "./client-object-preview-contract";
import fixture from "./fixtures/object-preview-wire.json";

const ready = fixture.ready;

describe("object preview wire contract", () => {
	it("admits named equipment placements through the shared DAT vocabulary", () => {
		const captured = decodeObjectPreviewResult(fixture.equipped);
		if (captured.outcome.kind !== "ready")
			throw new Error("Expected equipped fixture.");
		const source = objectPreviewSourceForRendering(captured.outcome.source);
		expect(source.attachments[0]).toEqual({
			visual: fixture.equipped.outcome.source.attachments[0].visual,
			parentLocation: "right-hand",
			placement: 1,
		});
		expect(source.background).toBeNull();
		expect(() =>
			decodeObjectPreviewResult({
				...fixture.equipped,
				outcome: {
					kind: "ready",
					source: {
						...fixture.equipped.outcome.source,
						attachments: [
							{
								...fixture.equipped.outcome.source.attachments[0],
								placement: "invented-placement",
							},
						],
					},
				},
			}),
		).toThrow();
	});
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
						body: {
							...ready.outcome.source.body,
							pose: { ...ready.outcome.source.body.pose, firstCyclicClip: 1 },
						},
					},
				},
			}),
		).toThrow("cyclic clip index");
	});
});
