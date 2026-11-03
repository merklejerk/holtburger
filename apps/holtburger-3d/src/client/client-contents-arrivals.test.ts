import { describe, expect, it } from "vitest";
import { ContentsArrivals } from "./client-contents-arrivals";
import type { ContentsArrivalContainer } from "./client-contents-arrivals";
import { entityFacts } from "./client-entity-mirror.test-support";

/** Accepted storage facts with explicit quantities, independent of sorting and cell positions. */
function section(
	container: number,
	entries: readonly (readonly [number, number])[],
): ContentsArrivalContainer {
	return {
		container: entityFacts(container, {
			storage: {
				kind: "container",
				roster: "announced",
				itemCapacity: 24,
				packCapacity: 7,
			},
		}),
		children: entries.map(([guid, count]) => {
			const item = entityFacts(guid);
			if (item.description.kind !== "known")
				throw new Error("Fixture must have a known description.");
			return {
				...item,
				description: { ...item.description, stackCount: count },
			};
		}),
	};
}

describe("contents arrival feedback", () => {
	it("ignores initial load and sorting, detects new identities and stack growth only", () => {
		const tracker = new ContentsArrivals();
		expect([
			...tracker
				.update(
					[
						section(1, [
							[10, 2],
							[11, 1],
						]),
					],
					false,
				)
				.keys(),
		]).toEqual([]);
		expect([
			...tracker
				.update(
					[
						section(1, [
							[11, 1],
							[10, 2],
						]),
					],
					false,
				)
				.keys(),
		]).toEqual([]);
		expect([
			...tracker
				.update(
					[
						section(1, [
							[10, 3],
							[12, 1],
						]),
					],
					false,
				)
				.keys(),
		]).toEqual([10, 12]);
		expect([
			...tracker
				.update(
					[
						section(1, [
							[10, 2],
							[12, 1],
						]),
					],
					false,
				)
				.keys(),
		]).toEqual([]);
	});

	it("detects transfers into an established destination but quietly baselines newly opened containers", () => {
		const tracker = new ContentsArrivals();
		tracker.update([section(1, [[10, 1]]), section(2, [])], false);
		expect([
			...tracker.update(
				[section(1, []), section(2, [[10, 1]]), section(3, [[11, 1]])],
				false,
			),
		]).toEqual([[10, 2]]);
	});

	it("baselines recovery and containers whose roster was awaiting", () => {
		const tracker = new ContentsArrivals();
		tracker.update([section(1, [])], false);
		tracker.update([section(1, [])], true);
		expect([...tracker.update([section(1, [[10, 1]])], false).keys()]).toEqual(
			[],
		);
		const awaiting = section(1, [[10, 1]]);
		tracker.update(
			[
				{
					...awaiting,
					container: entityFacts(1, {
						storage: {
							kind: "container",
							roster: "awaiting",
							itemCapacity: 24,
							packCapacity: 7,
						},
					}),
				},
			],
			false,
		);
		expect([
			...tracker
				.update(
					[
						section(1, [
							[10, 1],
							[11, 1],
						]),
					],
					false,
				)
				.keys(),
		]).toEqual([]);
	});
});
