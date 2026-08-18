import { describe, expect, it } from "vitest";
import { sceneVector3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import type { AudioTrigger } from "./audio-system";
import {
	AmbientSystem,
	type AmbientSystemDependencies,
} from "./ambient-system";
import {
	EMPTY_AMBIENT_SCAN_RESULT,
	type AmbientDescriptor,
	type AmbientScanResult,
} from "./ambient-scan";
import { AMBIENT_DIRECTION } from "./ambient-weighting";

const TABLE = "0x20000017" as DatAssetId;
const LISTENER = sceneVector3([0, 0, 0]);

function descriptor(
	overrides: Partial<AmbientDescriptor> = {},
): AmbientDescriptor {
	return {
		baseChance: 1,
		isContinuous: false,
		maxRate: 10,
		minRate: 10,
		slot: 0,
		soundTableId: TABLE,
		soundType: 70,
		tableIndex: 0,
		volume: 1,
		...overrides,
	};
}

/** A scan in which `descriptors` are the only contributors, each holding the whole weight. */
function scan(
	descriptors: readonly AmbientDescriptor[],
	shares: readonly number[] = descriptors.map(() => 1),
): AmbientScanResult {
	const accumulations = new Map(
		descriptors.map((entry, index) => [
			entry.slot,
			{
				descriptor: entry,
				// A real scan widens at least one band for every intermittent contributor; a
				// continuous descriptor never gets one.
				directions: entry.isContinuous
					? new Map()
					: new Map([[AMBIENT_DIRECTION.north, { maximum: 20, minimum: 4 }]]),
				soundCount: shares[index] ?? 1,
			},
		]),
	);
	return { accumulations, examinedCellCount: 64, totalWeight: 1 };
}

function build(overrides: Partial<AmbientSystemDependencies> = {}) {
	const played: AudioTrigger[] = [];
	// One slot at full weight, mirroring a listener surrounded by a single descriptor's ground.
	const weights = { bySlot: new Float32Array([1]), total: 1 };
	const system = new AmbientSystem({
		accumulateWeights: (outWeights) => {
			outWeights.set(
				weights.bySlot.subarray(
					0,
					Math.min(weights.bySlot.length, outWeights.length),
				),
			);
			return weights.total;
		},
		listenerHearsOutdoors: () => true,
		listenerPosition: () => LISTENER,
		play: (trigger) => {
			played.push(trigger);
			return "played";
		},
		resolveSound: () => ({
			probability: 1,
			soundId: "0x0A000234" as DatAssetId,
		}),
		roll: () => 0,
		...overrides,
	});
	system.resetForRegion(4);
	return { played, system, weights };
}

describe("AmbientSystem", () => {
	it("fires a continuous descriptor on its flat interval and never rolls a chance", () => {
		let rolls = 0;
		const { played, system } = build({
			roll: () => {
				rolls += 1;
				return 1;
			},
		});
		system.refresh(scan([descriptor({ isContinuous: true, minRate: 4 })]), 0);

		system.advance(3);
		expect(played).toHaveLength(0);
		system.advance(4);
		system.advance(8);

		expect(played).toHaveLength(2);
		// A roll of 1 would lose every chance test, so a continuous sound must not take one, and its
		// flat interval must not be rolled either.
		expect(rolls).toBe(0);
	});

	/**
	 * Continuous descriptors author `min_rate` equal to their wave's length, so the schedule must
	 * advance by whole intervals rather than from "now", or each fire adds a gap.
	 */
	it("keeps a continuous cadence exact instead of drifting from the service time", () => {
		const { played, system } = build();
		system.refresh(scan([descriptor({ isContinuous: true, minRate: 4 })]), 0);

		// Served late every time, as a frame-driven clock is.
		system.advance(4.3);
		system.advance(8.4);
		system.advance(12.2);

		expect(played).toHaveLength(3);
	});

	it("re-arms an intermittent descriptor across its authored range", () => {
		const { played, system } = build({ roll: () => 0.5 });
		system.refresh(scan([descriptor({ maxRate: 20, minRate: 10 })]), 0);

		// A mid-range roll puts the interval at 15 s.
		system.advance(14);
		expect(played).toHaveLength(0);
		system.advance(15);
		expect(played).toHaveLength(1);
		system.advance(29);
		expect(played).toHaveLength(1);
		system.advance(30);
		expect(played).toHaveLength(2);
	});

	it("suppresses an intermittent descriptor that loses its weighted chance", () => {
		const { played, system } = build({ roll: () => 0.9 });
		// Half the surroundings author it, so a base chance of 1 lands at 0.5 and a 0.9 roll loses.
		system.refresh(scan([descriptor({ baseChance: 1 })], [0.5]), 0);

		system.advance(20);

		expect(played).toHaveLength(0);
		expect(system.getDiagnostics().suppressedCount).toBe(1);
	});

	it("scales a continuous descriptor's gain by its share of the surroundings", () => {
		const { played, system } = build();
		system.refresh(
			scan(
				[descriptor({ isContinuous: true, minRate: 1, volume: 0.8 })],
				[0.5],
			),
			0,
		);

		system.advance(1);

		// Fired as a live bed: the supplier reads this frame's share (weights fixture: full share),
		// scaled by the authored volume.
		const source = played[0]!.source;
		if (source.mode !== "listener") throw new Error("expected a bed");
		expect(source.volume()).toBeCloseTo(0.8);
	});

	it("re-weights a playing bed's supplier live, without waiting for the next firing", () => {
		const { played, system, weights } = build();
		system.refresh(
			scan([descriptor({ isContinuous: true, minRate: 1, volume: 0.8 })]),
			0,
		);
		system.advance(1);
		const supplier = played[0]!.source;
		if (supplier.mode !== "listener") throw new Error("expected a bed");
		expect(supplier.volume()).toBeCloseTo(0.8);

		// The ground thins out: half the surroundings author this bed now.
		weights.bySlot[0] = 0.5;
		weights.total = 1;
		system.advance(1.5);

		expect(supplier.volume()).toBeCloseTo(0.4);
	});

	it("reads zero from a bed supplier once its descriptor retires or the region resets", () => {
		const { played, system } = build();
		system.refresh(
			scan([descriptor({ isContinuous: true, minRate: 1, volume: 0.8 })]),
			0,
		);
		system.advance(1);
		const supplier = played[0]!.source;
		if (supplier.mode !== "listener") throw new Error("expected a bed");

		// Every contributor gone: the scan retires the descriptor.
		system.refresh(
			{ accumulations: new Map(), examinedCellCount: 0, totalWeight: 0 },
			2,
		);
		expect(supplier.volume()).toBe(0);
	});

	it("silences bed suppliers while the listener is indoors, and restores them outside", () => {
		let outdoors = true;
		const { played, system } = build({ listenerHearsOutdoors: () => outdoors });
		system.refresh(
			scan([descriptor({ isContinuous: true, minRate: 1, volume: 0.8 })]),
			0,
		);
		system.advance(1);
		const source = played[0]!.source;
		if (source.mode !== "listener") throw new Error("expected a bed");
		expect(source.volume()).toBeCloseTo(0.8);

		// Through the dungeon door: the same gate feeds both cadences, so the playing bed fades
		// without waiting for a schedule refresh.
		outdoors = false;
		system.advance(1.5);
		expect(source.volume()).toBe(0);

		outdoors = true;
		system.advance(2);
		expect(source.volume()).toBeCloseTo(0.8);
	});

	it("reads zero from a bed supplier after a region reinstall clears the schedule", () => {
		const { played, system } = build();
		system.refresh(
			scan([descriptor({ isContinuous: true, minRate: 1, volume: 0.8 })]),
			0,
		);
		system.advance(1);
		const supplier = played[0]!.source;
		if (supplier.mode !== "listener") throw new Error("expected a bed");

		system.resetForRegion(2);
		expect(supplier.volume()).toBe(0);
	});

	it("does not schedule a continuous descriptor below the audible floor", () => {
		const { system } = build();
		// A tiny share puts its weighted volume under retail's 0.03 minimum.
		system.refresh(
			scan([descriptor({ isContinuous: true, volume: 0.01 })], [0.5]),
			0,
		);

		expect(system.getDiagnostics().scheduledCount).toBe(0);
	});

	it("retires a descriptor once no cell contributes to it", () => {
		const { system } = build();
		system.refresh(scan([descriptor()]), 0);
		expect(system.getDiagnostics().scheduledCount).toBe(1);

		system.refresh(
			{ accumulations: new Map(), examinedCellCount: 0, totalWeight: 0 },
			1,
		);

		expect(system.getDiagnostics().scheduledCount).toBe(0);
		expect(system.getDiagnostics().retiredCount).toBe(1);
	});

	/** Walking past a river must not restart its sound every time the scan re-runs. */
	it("keeps a surviving descriptor's clock across a refresh", () => {
		const { played, system } = build();
		system.refresh(scan([descriptor({ maxRate: 10, minRate: 10 })]), 0);

		system.advance(5);
		system.refresh(scan([descriptor({ maxRate: 10, minRate: 10 })]), 5);
		system.advance(10);

		expect(played).toHaveLength(1);
	});

	it("counts a due descriptor whose table has not staged instead of dropping it", () => {
		const { played, system } = build({ resolveSound: () => null });
		system.refresh(scan([descriptor()]), 0);

		system.advance(20);

		expect(played).toHaveLength(0);
		expect(system.getDiagnostics().unresolvedCount).toBe(1);
	});

	it("places an intermittent firing within the ground that authored it", () => {
		const { played, system } = build({ roll: () => 0.5 });
		const scanned = scan([descriptor()]);
		// The only contributors lie to the north, 40-60 m out.
		scanned.accumulations
			.get(0)!
			.directions.set(AMBIENT_DIRECTION.north, { maximum: 60, minimum: 40 });
		system.refresh(scanned, 0);

		system.advance(20);

		// Scene z runs negative to the north, so a northward placement moves away from the listener.
		const source = played[0]!.source;
		if (source.mode !== "world") throw new Error("expected a placed firing");
		expect(source.position[2]).toBeLessThan(LISTENER[2]);
	});

	it("fires a continuous descriptor head-locked, with no world position at all", () => {
		const { played, system } = build();
		system.refresh(scan([descriptor({ isContinuous: true, minRate: 1 })]), 0);

		system.advance(1);

		// Retail hardcodes distance 0 and pan 0 for these (acclient.c:366859); a bed has no
		// position to drift away from the listener.
		expect(played[0]!.source.mode).toBe("listener");
	});

	it("plays in the ambient category, so the ambient slider is what scales it", () => {
		const { played, system } = build();
		system.refresh(scan([descriptor()]), 0);

		system.advance(20);

		expect(played[0]!.category).toBe("ambient");
	});

	it("retires all active scheduled sounds when refreshed with an empty scan result", () => {
		const { system } = build();
		system.refresh(scan([descriptor()]), 0);
		expect(system.getDiagnostics().scheduledCount).toBe(1);

		system.refresh(EMPTY_AMBIENT_SCAN_RESULT, 1);
		expect(system.getDiagnostics().scheduledCount).toBe(0);
		expect(system.getDiagnostics().retiredCount).toBe(1);
	});
});
