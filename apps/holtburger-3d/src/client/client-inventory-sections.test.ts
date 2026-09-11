import { describe, expect, it } from "vitest";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import {
	clientInventorySections,
	clientInventoryPackSlots,
	sortInventoryItems,
} from "./client-inventory-sections";

/** Explicit received slot kind; storage capability is supplied independently. */
function child(
	guid: number,
	parentGuid: number,
	slot: Extract<ClientEntityFacts["location"], { kind: "contained" }>["slot"],
	storage = false,
): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		location: { kind: "contained", parentGuid, slot },
		scenePlacement: "unavailable",
		storage: storage
			? {
					kind: "container",
					roster: "announced",
					packCapacity: 7,
					itemCapacity: 24,
				}
			: { kind: "not-established" },
	});
}

describe("clientInventorySections", () => {
	it("uses server order and separates foci, ordinary-slot storage, and direct pack sections", () => {
		const mirror = new ClientEntityMirror();
		const prepared = mirror.prepareSnapshot(
			{
				entities: [
					entityFacts(1),
					child(20, 1, { kind: "pack", index: 1, entryKind: "foci" }),
					child(30, 1, { kind: "item", index: 1 }, true),
					child(
						10,
						1,
						{ kind: "pack", index: 0, entryKind: "container" },
						true,
					),
					child(40, 1, { kind: "item", index: 0 }),
					child(50, 10, { kind: "item", index: 0 }, true),
					child(60, 1, { kind: "pending" }),
					entityFacts(70, {
						ownedByPlayer: true,
						location: { kind: "equipped", wearerGuid: 1 },
					}),
				],
			},
			1,
		);
		const sections = clientInventorySections(prepared.level);
		expect(sections.map((section) => section.container.guid)).toEqual([
			1, 30, 10,
		]);
		expect(
			sections.map((section) => section.items.map((item) => item.guid)),
		).toEqual([[40, 30], [], [50]]);
		expect(
			sections.map((section) => section.packs.map((item) => item.guid)),
		).toEqual([[20], [], []]);
		expect(
			sections.map((section) => section.unslotted.map((item) => item.guid)),
		).toEqual([[60], [], []]);
		expect(sections.map((section) => section.mainPack)).toEqual([
			true,
			false,
			false,
		]);
	});

	it("retains pending entries and empty or awaiting containers without inventing storage from category", () => {
		const mirror = new ClientEntityMirror();
		const pending: ClientEntityFacts = {
			...child(2, 1, { kind: "pack", index: 0, entryKind: "container" }),
			description: { kind: "pending" },
		};
		const awaiting: ClientEntityFacts = {
			...child(3, 1, { kind: "pack", index: 1, entryKind: "container" }, true),
			storage: {
				kind: "container",
				roster: "awaiting",
				packCapacity: null,
				itemCapacity: null,
			},
		};
		const prepared = mirror.prepareSnapshot(
			{
				entities: [
					entityFacts(1),
					pending,
					awaiting,
					child(4, 1, { kind: "pack", index: 2, entryKind: "container" }, true),
				],
			},
			1,
		);
		const sections = clientInventorySections(prepared.level);
		expect(sections.map((section) => section.container.guid)).toEqual([
			1, 3, 4,
		]);
		expect(sections[0]?.packs).toEqual([pending]);
		expect(sections[1]?.container.storage).toEqual({
			kind: "container",
			roster: "awaiting",
			packCapacity: null,
			itemCapacity: null,
		});
		expect(sections[2]?.items).toEqual([]);
	});
});

describe("clientInventoryPackSlots", () => {
	it("preserves server slot positions, includes foci, and leaves free capacity empty", () => {
		const root = entityFacts(1, {
			storage: {
				kind: "container",
				roster: "announced",
				itemCapacity: 24,
				packCapacity: 4,
			},
		});
		const bag = child(
			2,
			1,
			{ kind: "pack", index: 2, entryKind: "container" },
			true,
		);
		const foci = child(3, 1, { kind: "pack", index: 0, entryKind: "foci" });
		const ordinary = child(4, 1, { kind: "item", index: 0 }, true);
		const mirror = new ClientEntityMirror();
		const { level } = mirror.prepareSnapshot(
			{ entities: [root, bag, foci, ordinary] },
			1,
		);
		expect(
			clientInventoryPackSlots(level).map((item) => item?.guid ?? null),
		).toEqual([1, 3, null, 2, null]);
		const unknown = {
			...root,
			storage: {
				kind: "container" as const,
				roster: "announced" as const,
				itemCapacity: null,
				packCapacity: null,
			},
		};
		const pending = mirror.prepareSnapshot({ entities: [unknown, bag] }, 1);
		expect(
			clientInventoryPackSlots(pending.level).map((item) => item?.guid ?? null),
		).toEqual([1, null, null, 2]);
	});
});

describe("sortInventoryItems", () => {
	it("sorts names and types without changing native order or placing unknown names first", () => {
		const named = (guid: number, name: string, itemType: number) => ({
			...child(guid, 1, { kind: "item" as const, index: guid }),
			description: {
				kind: "known" as const,
				name,
				itemType,
				healthQuery: "ineligible" as const,
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: null,
			},
		});
		const native = [
			named(2, "Zebra", 1),
			named(3, "apple", 2),
			named(4, "Apple", 1),
			{
				...child(5, 1, { kind: "item" as const, index: 5 }),
				description: { kind: "pending" as const },
			},
		];
		expect(
			sortInventoryItems(native, "alphabetical").map((item) => item.guid),
		).toEqual([3, 4, 2, 5]);
		expect(
			sortInventoryItems(native, "item-type").map((item) => item.guid),
		).toEqual([4, 2, 3, 5]);
		expect(sortInventoryItems(native, "native")).toBe(native);
		expect(native.map((item) => item.guid)).toEqual([2, 3, 4, 5]);
	});
});
