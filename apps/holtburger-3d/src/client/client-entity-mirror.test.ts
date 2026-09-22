import { describe, expect, it } from "vitest";
import {
	ClientEntityMirror,
	clientEntityDeltaSchema,
} from "./client-entity-mirror";
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
		targeting: "ineligible",
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
	const prepared = mirror.prepareDelta({
		projectileSupply: null,
		worldContainer: null,
		upserts,
		removed,
	});
	if (prepared === null)
		throw new Error("Fixture requires current semantic state.");
	mirror.commit(prepared);
}

describe("ClientEntityMirror", () => {
	it("accepts supply-only changes and replaces supply on resynchronization", () => {
		const store = mirror();
		const prepared = store.prepareDelta({
			projectileSupply: { kind: "finite", count: 17 },
			worldContainer: null,
			upserts: [],
			removed: [],
		});
		if (prepared === null) throw new Error("Current mirror required");
		store.commit(prepared);
		expect(store.read()).toMatchObject({
			kind: "current",
			level: { projectileSupply: { kind: "finite", count: 17 } },
		});
		commit(store, [entityFacts(player)]);
		expect(store.read()).toMatchObject({
			kind: "current",
			level: { projectileSupply: { kind: "finite", count: 17 } },
		});
		const pending = store.prepareDelta({
			projectileSupply: { kind: "pending", appraisal: null },
			worldContainer: null,
			upserts: [],
			removed: [],
		});
		if (pending === null) throw new Error("Current mirror required");
		store.commit(pending);
		expect(store.read()).toMatchObject({
			kind: "current",
			level: { projectileSupply: { kind: "pending", appraisal: null } },
		});
		store.awaitSnapshot();
		expect(store.read()).toEqual({ kind: "pending" });
		store.commit(
			store.prepareSnapshot(
				{
					...playerEntitySnapshot(player),
					projectileSupply: { kind: "unlimited" },
				},
				player,
			),
		);
		expect(store.read()).toMatchObject({
			kind: "current",
			level: { projectileSupply: { kind: "unlimited" } },
		});
	});
	it("preserves icon appearance through inventory-only deltas and recovery snapshots", () => {
		const store = mirror();
		const before = owned(item, player);
		if (before.description.kind !== "known")
			throw new Error("Known fixture required.");
		const appearance = {
			base: 0x06000001,
			overlay: 0x06000002,
			underlay: null,
			uiEffects: 0x80000001,
		};
		const updated = {
			...before,
			description: { ...before.description, icon: appearance },
		};
		commit(store, [before]);
		commit(store, [updated]);
		const deltaRead = store.read();
		if (deltaRead.kind !== "current")
			throw new Error("Current level required.");
		expect(deltaRead.level.entities.get(item)).toEqual(updated);
		store.awaitSnapshot();
		store.commit(
			store.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
					entities: [entityFacts(player), updated],
				},
				player,
			),
		);
		const recovered = store.read();
		if (recovered.kind !== "current")
			throw new Error("Current level required.");
		expect(recovered.level.entities.get(item)).toEqual(
			deltaRead.level.entities.get(item),
		);
		expect(() =>
			clientEntityDeltaSchema.parse({
				upserts: [
					{
						...updated,
						description: {
							...updated.description,
							icon: { ...appearance, base: 0 },
						},
					},
				],
				removed: [],
			}),
		).toThrow();
		expect(store.read()).toBe(recovered);
	});

	it("prepares a child-before-parent delta without exposing a partial level", () => {
		const store = mirror();
		const before = store.read();
		const next = store.prepareDelta({
			projectileSupply: null,
			worldContainer: null,
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
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
					entities: [entityFacts(player), entityFacts(player)],
				},
				player,
			),
		).toThrow("Duplicate");
		expect(() =>
			store.prepareDelta({
				projectileSupply: null,
				worldContainer: null,
				upserts: [owned(item, player)],
				removed: [item],
			}),
		).toThrow("both upserted and removed");
		expect(() =>
			store.prepareDelta({
				projectileSupply: null,
				worldContainer: null,
				upserts: [owned(item, pack)],
				removed: [],
			}),
		).toThrow("missing parent");
		expect(store.read()).toBe(before);
	});

	it("gates deltas while recovery is pending and replaces the full domain", () => {
		const store = mirror();
		commit(store, [owned(item, player)]);
		store.awaitSnapshot();
		expect(store.read().kind).toBe("pending");
		expect(
			store.prepareDelta({
				projectileSupply: null,
				worldContainer: null,
				upserts: [owned(pack, player)],
				removed: [],
			}),
		).toBeNull();
		store.commit(store.prepareSnapshot(playerEntitySnapshot(player), player));
		const read = store.read();
		if (read.kind !== "current") throw new Error("Expected current level.");
		expect([...read.level.entities.keys()]).toEqual([player]);
	});
});
