import { describe, expect, it } from "vitest";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { selectOfferItems } from "./client-offer-selection";

function child(
	guid: number,
	parentGuid: number,
	eligible: boolean,
): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		canOfferTrade: eligible,
		location: {
			kind: "contained",
			parentGuid,
			slot: { kind: "item", index: guid },
		},
	});
}

const pack: ClientEntityFacts = {
	...child(10, 1, true),
	storage: {
		kind: "container",
		roster: "announced",
		itemCapacity: 24,
		packCapacity: 0,
	},
};

const mainPack = entityFacts(1, { storage: pack.storage, canOfferTrade: true });

function select(
	records: readonly ClientEntityFacts[],
	item = pack.guid,
	root = mainPack,
) {
	const mirror = new ClientEntityMirror();
	const snapshot = playerEntitySnapshot(1);
	mirror.commit(
		mirror.prepareSnapshot({ ...snapshot, entities: [root, ...records] }, 1),
	);
	const selection = selectOfferItems(
		mirror.read(),
		item,
		(facts) => facts.canOfferTrade,
	);
	return selection.kind === "selected"
		? { ...selection, items: selection.items.map((item) => item.guid) }
		: selection;
}

describe("inventory offer selection", () => {
	it("selects only Main Pack's page and excludes equipment and pack navigation entries", () => {
		const carried = {
			...pack,
			canOfferTrade: true,
			location: {
				kind: "contained" as const,
				parentGuid: 1,
				slot: {
					kind: "pack" as const,
					index: 0,
					entryKind: "container" as const,
				},
			},
		};
		expect(
			select(
				[
					child(2, 1, true),
					child(3, 1, false),
					carried,
					child(11, carried.guid, true),
					entityFacts(4, {
						ownedByPlayer: true,
						canOfferTrade: true,
						location: { kind: "equipped", wearerGuid: 1, mask: 1 },
					}),
				],
				1,
			),
		).toEqual({ kind: "selected", items: [2] });
	});
	it("never offers the character root when Main Pack has no eligible page contents", () => {
		expect(select([], 1)).toEqual({ kind: "selected", items: [] });
		expect(select([child(2, 1, false)], 1)).toEqual({
			kind: "selected",
			items: [],
		});
		expect(select([], 1, entityFacts(1))).toMatchObject({
			kind: "unavailable",
		});
	});
	it("selects an eligible empty pack itself", () => {
		expect(select([pack])).toEqual({ kind: "selected", items: [pack.guid] });
	});
	it("selects eligible direct contents without expanding nested packs", () => {
		const nested = { ...child(20, pack.guid, false), storage: pack.storage };
		expect(
			select([
				pack,
				child(11, pack.guid, true),
				child(12, pack.guid, false),
				nested,
				child(21, nested.guid, true),
			]),
		).toEqual({ kind: "selected", items: [11] });
	});
	it("never substitutes the pack when all contents are ineligible or undescribed", () => {
		expect(
			select([
				pack,
				child(11, pack.guid, false),
				{ ...child(12, pack.guid, true), description: { kind: "pending" } },
			]),
		).toEqual({ kind: "selected", items: [] });
	});
	it("refuses an unknown roster rather than guessing that the pack is empty", () => {
		expect(
			select([
				{
					...pack,
					storage: {
						kind: "container",
						roster: "awaiting",
						itemCapacity: 24,
						packCapacity: 0,
					},
				},
			]),
		).toMatchObject({ kind: "unavailable" });
		expect(
			selectOfferItems({ kind: "pending" }, pack.guid, () => true),
		).toMatchObject({ kind: "unavailable" });
	});
	it("rejects unowned sources", () => {
		expect(
			select([{ ...pack, ownedByPlayer: false, location: { kind: "none" } }]),
		).toMatchObject({ kind: "unavailable" });
	});
});
