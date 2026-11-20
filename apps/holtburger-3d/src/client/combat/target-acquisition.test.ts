import { describe, expect, it } from "vitest";
import { ClientCycleSelectionController } from "../world/cycle-selection-controller";
import { ClientEntityMirror } from "../world/entity-mirror";
import { playerEntitySnapshot } from "../world/entity-mirror.test-support";
import { ClientEntitySelection } from "../world/entity-selection";
import {
	rankCycleCandidates,
	resolveImmediateCandidate,
	type CycleCandidate,
	type CycleFilter,
} from "./target-acquisition";

/** Test-owned acquisition facts; no tuning value participates in these algorithm inputs. */
function candidate(
	guid: number,
	distance: number,
	options: {
		readonly alignment?: number;
		readonly band?: number;
		readonly immediate?: number | null;
		readonly filters?: CycleCandidate["filters"];
	} = {},
): CycleCandidate {
	const immediate =
		options.immediate === undefined ? distance : options.immediate;
	return {
		guid,
		distanceSquared: distance ** 2,
		distanceBand: options.band ?? 0,
		forwardAlignment: options.alignment ?? 1,
		smartImmediate:
			immediate === null ? null : { distanceSquared: immediate ** 2 },
		filters: options.filters ?? { "smart-combat": "cycle" },
	};
}

function controller(candidates: readonly CycleCandidate[]) {
	const entities = new ClientEntityMirror();
	entities.commit(entities.prepareSnapshot(playerEntitySnapshot(1), 1));
	const selection = new ClientEntitySelection({
		lifecycle: {
			entities,
			tradeSnapshot: () => ({ trade: null }),
			subscribe: () => () => {},
		},
		presentation: () => null,
	});
	const cycle = new ClientCycleSelectionController({
		selection,
		sample: () => candidates,
	});
	return { selection, cycle };
}

describe("pure immediate acquisition", () => {
	const pool = [
		candidate(2, 3, { immediate: null, band: 0 }),
		candidate(3, 2, { band: 0, alignment: 0.5 }),
		candidate(4, 1, { band: 0, filters: { "smart-combat": "immediate-only" } }),
		candidate(5, 4, { band: 1 }),
		candidate(6, 0.5, { filters: { corpse: "fallback" } }),
		candidate(7, 0.75, {
			filters: { corpse: "cycle", "non-creature": "cycle" },
		}),
	];

	it.each(["smart-combat", "non-creature", "corpse"] as const)(
		"%s preview agrees with the traversal ranking winner",
		(filter: CycleFilter) => {
			expect(resolveImmediateCandidate(pool, filter)).toBe(
				rankCycleCandidates(pool, filter).immediate,
			);
		},
	);

	it("admits immediate-only winners into the ring while skipping other immediate-only members", () => {
		const ranked = rankCycleCandidates(pool, "smart-combat");
		expect(ranked.immediate?.guid).toBe(4);
		expect(ranked.matching.map(({ guid }) => guid)).toEqual([4, 2, 3, 5]);
	});

	it("ranks immediate-fallback below primary immediate targets, but lets it win when no primary immediate exists", () => {
		const closerFallback = candidate(11, 0.25, {
			band: 0,
			filters: { "smart-combat": "immediate-fallback" },
		});
		const fartherFallback = candidate(12, 0.75, {
			band: 0,
			filters: { "smart-combat": "immediate-fallback" },
		});
		const fartherPrimaryImmediate = candidate(13, 2, {
			band: 0,
			filters: { "smart-combat": "immediate-only" },
		});
		const fartherPrimaryCycle = candidate(15, 2.5, {
			band: 0,
			filters: { "smart-combat": "cycle" },
		});
		const distantCycle = candidate(14, 10, {
			band: 2,
			immediate: null,
			filters: { "smart-combat": "cycle" },
		});

		// Any primary immediate target (cycle or immediate-only) beats a closer immediate-fallback.
		const withImmediateOnly = rankCycleCandidates(
			[closerFallback, fartherPrimaryImmediate, distantCycle],
			"smart-combat",
		);
		expect(withImmediateOnly.immediate?.guid).toBe(13);
		expect(withImmediateOnly.matching.map(({ guid }) => guid)).toEqual([
			13, 14,
		]);
		expect(
			resolveImmediateCandidate(
				[fartherPrimaryImmediate, closerFallback, distantCycle],
				"smart-combat",
			)?.guid,
		).toBe(13);

		const withCycleImmediate = rankCycleCandidates(
			[closerFallback, fartherPrimaryCycle, distantCycle],
			"smart-combat",
		);
		expect(withCycleImmediate.immediate?.guid).toBe(15);
		expect(withCycleImmediate.matching.map(({ guid }) => guid)).toEqual([
			15, 14,
		]);

		// When only distant non-immediate targets exist, the nearest immediate-fallback wins and others stay out of the ring.
		const fallbackWins = rankCycleCandidates(
			[fartherFallback, closerFallback, distantCycle],
			"smart-combat",
		);
		expect(fallbackWins.immediate?.guid).toBe(11);
		expect(fallbackWins.matching.map(({ guid }) => guid)).toEqual([11, 14]);
	});

	it("excludes fallback members while a primary member exists, then admits them", () => {
		expect(resolveImmediateCandidate(pool, "corpse")?.guid).toBe(7);
		const fallbackOnly = pool.filter(({ guid }) => guid !== 7);
		expect(resolveImmediateCandidate(fallbackOnly, "corpse")?.guid).toBe(6);
	});

	it("breaks equal acquisition distances by band, alignment, then GUID", () => {
		const tied = [
			candidate(9, 2, { alignment: 0.9 }),
			candidate(8, 2, { alignment: 0.9 }),
			candidate(10, 2, { alignment: 1 }),
		];
		expect(resolveImmediateCandidate(tied, "smart-combat")?.guid).toBe(10);
		expect(
			resolveImmediateCandidate(tied.slice(0, 2), "smart-combat")?.guid,
		).toBe(8);
	});

	it("does not resolve a Smart immediate outside its cone or band", () => {
		expect(
			resolveImmediateCandidate(
				[candidate(2, 1, { immediate: null })],
				"smart-combat",
			),
		).toBeUndefined();
	});

	it("repeated passive previews cannot change subsequent traversal", () => {
		const previewed = controller(pool);
		const untouched = controller(pool);
		const sequence: (readonly [CycleFilter, 1 | -1])[] = [
			["smart-combat", 1],
			["smart-combat", 1],
			["corpse", 1],
			["smart-combat", -1],
		];
		for (const [filter, direction] of sequence) {
			for (let preview = 0; preview < 5; preview += 1)
				resolveImmediateCandidate(pool, "smart-combat");
			previewed.cycle.cycle(filter, direction);
			untouched.cycle.cycle(filter, direction);
			expect(previewed.selection.selectedGuid()).toBe(
				untouched.selection.selectedGuid(),
			);
		}
	});
});
