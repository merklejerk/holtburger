import { describe, expect, it } from "vitest";

import {
	decodeExplorerPossession,
	decodePossessionEventQueueReceipt,
	decodePossessionIntentResult,
	possessionStance,
} from "./explorer-entity-possession";

const nonCombatCapability = {
	chargeDurationMs: 1_000,
	jumpPresentation: "ready-only",
	run: "standard-fallback-with-target-presentation",
	sidestep: "standard-fallback-without-target-presentation",
	style: 0x8000_003d,
	turn: "target-authored",
	walk: "target-authored",
} as const;

describe("decodeExplorerPossession", () => {
	it("keeps entity and possession generations beside per-stance source facts", () => {
		const possession = decodeExplorerPossession({
			acceptedStance: 0x8000_003d,
			entityGeneration: 7,
			guid: 0xf0000001,
			motionTableId: "0x09000001",
			possessionGeneration: 9,
			runRateCapability: { initial: 1, maximum: 10, minimum: 1 },
			stances: [nonCombatCapability],
		});

		expect(possession.guid).toBe(0xf0000001);
		if (possession.guid === null) throw new Error("expected active possession");
		expect(possession.entityGeneration).toBe(7);
		expect(possessionStance(possession, 0x8000_003d)).toEqual(
			nonCombatCapability,
		);
	});

	it("requires a release receipt to carry the new possession ownership barrier", () => {
		expect(
			decodeExplorerPossession({
				acceptedStance: null,
				entityGeneration: null,
				guid: null,
				motionTableId: null,
				possessionGeneration: 10,
				runRateCapability: null,
				stances: [],
			}).possessionGeneration,
		).toBe(10);
	});

	it("rejects contradictory partial release state", () => {
		expect(() =>
			decodeExplorerPossession({
				acceptedStance: null,
				entityGeneration: 7,
				guid: null,
				motionTableId: null,
				possessionGeneration: 10,
				runRateCapability: null,
				stances: [],
			}),
		).toThrow();
	});
});

describe("possession command outcomes", () => {
	it("keeps stale ownership, stale revision, and duplicate edge outcomes distinct", () => {
		expect(decodePossessionIntentResult("ignored-stale-possession")).toBe(
			"ignored-stale-possession",
		);
		expect(decodePossessionIntentResult("ignored-stale-revision")).toBe(
			"ignored-stale-revision",
		);
		expect(
			decodePossessionEventQueueReceipt({
				result: "ignored-duplicate",
				outcomes: [],
			}).result,
		).toBe("ignored-duplicate");
	});

	it("keeps an immediate nonphysical rejection typed and generation-bound", () => {
		expect(
			decodePossessionEventQueueReceipt({
				result: "queued",
				outcomes: [
					{
						possessionGeneration: 9,
						sequence: 0,
						result: {
							kind: "rejected",
							reason: "nonphysical-response",
						},
					},
				],
			}).outcomes[0]?.result,
		).toEqual({ kind: "rejected", reason: "nonphysical-response" });
	});
});
