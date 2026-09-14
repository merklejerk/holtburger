import { expect, it } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";
import {
	initialActionBar,
	bindActionCell,
	type ConsumableIdentity,
} from "./client-action-bar-state";
import { bindingAction } from "./client-action-item";
import { reconcileActionBars } from "./client-action-bar-reconciliation";

const identity: ConsumableIdentity = {
	wcid: 42,
	category: "charged-mana-stone",
};
function supply(
	guid: number,
	availability: "ready" | "pending" | "exhausted" = "ready",
	key = identity,
): ClientEntityFacts {
	const item = entityFacts(guid, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: 1,
			slot: { kind: "item", index: 0 },
		},
	});
	if (item.description.kind !== "known")
		throw new Error("Expected described fixture");
	return {
		...item,
		description: {
			...item.description,
			useCapability: "targeted",
			consumable: { identity: key, availability },
		},
	};
}
function read(items: ClientEntityFacts[]): ClientEntityRead {
	return {
		kind: "current",
		level: {
			revision: 1,
			playerGuid: 1,
			entities: new Map(
				[entityFacts(1), ...items].map((item) => [item.guid, item]),
			),
		},
	};
}
function bound() {
	return bindActionCell(
		[initialActionBar()],
		{ bar: 1, slot: 0 },
		bindingAction(supply(10)),
	);
}
it("keeps a suitable instance and chooses a stable replacement across packs without reserving it", () => {
	let bars = bound();
	bars = bindActionCell(bars, { bar: 1, slot: 1 }, bindingAction(supply(10)));
	expect(reconcileActionBars(bars, read([supply(10), supply(5)]))).toBe(bars);
	const replacement = {
		...supply(5),
		location: {
			kind: "contained" as const,
			parentGuid: 20,
			slot: { kind: "item" as const, index: 0 },
		},
	};
	const result = reconcileActionBars(bars, read([supply(9), replacement]));
	expect(result[0]?.slots.slice(0, 2)).toEqual([
		bindingAction(replacement),
		bindingAction(replacement),
	]);
});
it("replaces depleted stones and ownership loss but rejects empty stones and other templates", () => {
	const bars = bound();
	expect(
		reconcileActionBars(bars, read([supply(10, "exhausted"), supply(11)]))[0]
			?.slots[0]?.item,
	).toBe(11);
	expect(
		reconcileActionBars(
			bars,
			read([{ ...supply(10), ownedByPlayer: false }, supply(11)]),
		)[0]?.slots[0]?.item,
	).toBe(11);
	const cleared = reconcileActionBars(
		bars,
		read([
			supply(11, "exhausted"),
			supply(12, "ready", { ...identity, wcid: 43 }),
		]),
	);
	expect(cleared[0]?.slots[0]).toBeNull();
	expect(reconcileActionBars(cleared, read([supply(11)]))).toBe(cleared);
});
it("suspends clearing for recovery, pending items, and unannounced packs", () => {
	const bars = bound();
	expect(reconcileActionBars(bars, { kind: "pending" })).toBe(bars);
	expect(reconcileActionBars(bars, read([supply(10, "pending")]))).toBe(bars);
	const pending = { ...supply(11), description: { kind: "pending" as const } };
	expect(reconcileActionBars(bars, read([pending]))).toBe(bars);
	const pack = {
		...entityFacts(20),
		ownedByPlayer: true,
		storage: {
			kind: "container" as const,
			roster: "awaiting" as const,
			itemCapacity: null,
			packCapacity: null,
		},
	};
	expect(reconcileActionBars(bars, read([pack]))).toBe(bars);
	expect(
		reconcileActionBars(bars, read([pending, supply(12)]))[0]?.slots[0]?.item,
	).toBe(12);
});
it("keeps explicit empty-stone drain bindings exact and retains pending kit identity", () => {
	expect(bindingAction(supply(10, "exhausted"))?.replacement).toBeNull();
	expect(
		bindingAction(
			supply(10, "pending", { ...identity, category: "healing-kit" }),
		)?.replacement?.category,
	).toBe("healing-kit");
});
