import { describe, it, expect } from "vitest";
import {
	INVENTORY_CURRENCIES,
	inventoryCurrencyTotals,
} from "./client-inventory-currencies";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientEntityFacts } from "./client-entity-mirror";

const currency = INVENTORY_CURRENCIES[0];
function carried(
	guid: number,
	count: number | null,
	parentGuid = 1,
): ClientEntityFacts {
	const record = entityFacts(guid);
	if (record.description.kind !== "known")
		throw new Error("Known fixture required");
	return {
		...record,
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid,
			slot: { kind: "item", index: 0 },
		},
		description: {
			...record.description,
			wcid: currency[0],
			stackCount: count,
		},
	};
}
const total = (...items: ClientEntityFacts[]) =>
	inventoryCurrencyTotals({
		playerGuid: 1,
		revision: 1,
		entities: new Map(
			[
				entityFacts(1, {
					storage: {
						kind: "container",
						roster: "announced",
						itemCapacity: 24,
						packCapacity: 7,
					},
				}),
				...items,
			].map((item) => [item.guid, item]),
		),
	});
describe("ambient currency balances", () => {
	it("combines stacks across deeper packs and single items, excluding unowned and equipped items", () => {
		const excluded = carried(5, 100);
		const result = total(
			carried(2, 4),
			carried(3, 7, 20),
			carried(4, null),
			{ ...excluded, ownedByPlayer: false },
			{ ...carried(6, 100), location: { kind: "equipped", wearerGuid: 1 } },
		);
		expect(result).toEqual({
			pending: false,
			totals: [
				{ wcid: currency[0], name: currency[1], base: currency[2], count: 12 },
			],
		});
		expect(total().totals).toEqual([]);
		expect(total(carried(2, 0)).totals).toEqual([]);
	});
	it("marks partial hydration pending", () => {
		expect(
			total({ ...carried(2, 1), description: { kind: "pending" } }).pending,
		).toBe(true);
		expect(
			total({
				...carried(2, 1),
				storage: {
					kind: "container",
					roster: "awaiting",
					itemCapacity: null,
					packCapacity: null,
				},
			}).pending,
		).toBe(true);
	});
	it("keeps distinct currencies with the same artwork separate and orders alphabetically", () => {
		// These currencies share artwork but retain separate names and balances.
		const selected = ["Rare Coin", "Hero Token", "Imbue Swap Coin"];
		const currencies = selected.map((name) => {
			const entry = INVENTORY_CURRENCIES.find((entry) => entry[1] === name);
			if (!entry) throw new Error(`Missing currency fixture: ${name}`);
			return entry;
		});
		const items = currencies.map(([wcid], index) => {
			const record = carried(index + 2, 1);
			if (record.description.kind !== "known")
				throw new Error("Known fixture required");
			return { ...record, description: { ...record.description, wcid } };
		});
		expect(total(...items).totals.map((row) => row.name)).toEqual([
			"Hero Token",
			"Imbue Swap Coin",
			"Rare Coin",
		]);
	});
});
