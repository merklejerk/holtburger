import { describe, expect, it } from "vitest";
import { ClientEntityMirror } from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";

const player = 1;
const pack = 2;
const item = 3;
const owned = (guid: number, parent: number) =>
	entityFacts(guid, {
		ownedByPlayer: true,
		scenePlacement: "unavailable",
		location: {
			kind: "contained",
			parentGuid: parent,
			slot: { kind: "item", index: 0 },
		},
	});

function mirror(): ClientEntityMirror {
	const result = new ClientEntityMirror();
	result.commit(result.prepareSnapshot(playerEntitySnapshot(player), player));
	return result;
}

function commit(
	mirror: ClientEntityMirror,
	upserts: ReturnType<typeof entityFacts>[],
	removed: number[] = [],
): void {
	const prepared = mirror.prepareDelta({ upserts, removed });
	if (prepared === null)
		throw new Error("Fixture requires current semantic state.");
	mirror.commit(prepared);
}

describe("ClientEntityMirror", () => {
	it("prepares a child-before-parent delta without exposing a partial level", () => {
		const store = mirror();
		const before = store.read();
		const next = store.prepareDelta({
			upserts: [owned(item, pack), owned(pack, player)],
			removed: [],
		});
		expect(store.read()).toBe(before);
		if (next === null) throw new Error("Expected prepared update.");
		store.commit(next);
		const after = store.read();
		if (after.kind !== "current" || before.kind !== "current")
			throw new Error("Expected current levels.");
		expect(after.level.entities.get(item)?.ownedByPlayer).toBe(true);
		expect(before.level.entities.has(item)).toBe(false);
	});

	it("replaces a root relationship and its descendant ownership in one level", () => {
		const store = mirror();
		commit(store, [owned(pack, player), owned(item, pack)]);
		commit(store, [
			entityFacts(pack),
			{ ...owned(item, pack), ownedByPlayer: false },
		]);
		const read = store.read();
		if (read.kind !== "current") throw new Error("Expected current level.");
		expect(read.level.entities.get(item)?.ownedByPlayer).toBe(false);
	});

	it("keeps previous state on duplicate or contradictory batches", () => {
		const store = mirror();
		const before = store.read();
		expect(() =>
			store.prepareSnapshot(
				{ entities: [entityFacts(player), entityFacts(player)] },
				player,
			),
		).toThrow("Duplicate");
		expect(() =>
			store.prepareDelta({ upserts: [owned(item, player)], removed: [item] }),
		).toThrow("both upserted and removed");
		expect(() =>
			store.prepareDelta({ upserts: [owned(item, pack)], removed: [] }),
		).toThrow("missing parent");
		expect(store.read()).toBe(before);
	});

	it("gates deltas while recovery is pending and replaces the full domain", () => {
		const store = mirror();
		commit(store, [owned(item, player)]);
		store.awaitSnapshot();
		expect(store.read().kind).toBe("pending");
		expect(
			store.prepareDelta({ upserts: [owned(pack, player)], removed: [] }),
		).toBeNull();
		store.commit(store.prepareSnapshot(playerEntitySnapshot(player), player));
		const read = store.read();
		if (read.kind !== "current") throw new Error("Expected current level.");
		expect([...read.level.entities.keys()]).toEqual([player]);
	});
});
