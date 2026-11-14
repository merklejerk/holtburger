import { describe, expect, it } from "vitest";
import { ClientPackAffinities } from "./client-pack-affinities";
import { packAffinitiesSchema } from "./client-pack-affinity-contract";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { createDefaultClientCharacterSettings } from "./client-settings-defaults";
import type { ClientCharacterSettingsState } from "./client-character-settings-owner";

const PLAYER = 1;
const PACK = 2;
const ITEM = 3;
const OTHER_PACK = 4;

function contained(guid: number, parent: number): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: parent,
			slot: { kind: "item", index: 0 },
		},
	});
}

function pack(guid: number, index: number, player = PLAYER): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: player,
			slot: { kind: "pack", entryKind: "container", index },
		},
	});
}

function equipped(guid: number, player = PLAYER): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		location: { kind: "equipped", wearerGuid: player, mask: null },
	});
}

function read(
	records: readonly ClientEntityFacts[],
	player = PLAYER,
): ClientEntityRead {
	const snapshot = playerEntitySnapshot(player);
	return {
		kind: "current",
		level: {
			...snapshot,
			revision: 1,
			playerGuid: player,
			entities: new Map(
				[...snapshot.entities, ...records].map((record) => [
					record.guid,
					record,
				]),
			),
		},
	};
}

function settings(
	affinities: Readonly<Record<string, number>>,
	characterGuid = PLAYER,
): ClientCharacterSettingsState {
	return {
		kind: "ready",
		characterGuid,
		generation: characterGuid,
		lastKnownName: null,
		settings: {
			...createDefaultClientCharacterSettings(),
			packAffinities: affinities,
		},
	};
}

describe("ClientPackAffinities", () => {
	it("remembers containment through equip, missing records, and receiver recovery", () => {
		const owner = new ClientPackAffinities();
		owner.observe(read([pack(PACK, 0), contained(ITEM, PACK)]));
		owner.observe(
			read([
				pack(PACK, 0),
				entityFacts(ITEM, {
					ownedByPlayer: true,
					location: { kind: "equipped", wearerGuid: PLAYER, mask: null },
				}),
			]),
		);
		owner.observe({ kind: "pending" });
		owner.observe(read([]));
		expect(owner.storage(read([equipped(ITEM)])).preferred[ITEM]).toBe(PACK);
	});

	it("learns automatic overflow just like any other observed container", () => {
		const owner = new ClientPackAffinities();
		owner.observe(read([pack(PACK, 0), contained(ITEM, PACK)]));
		owner.observe(read([pack(PACK, 0), contained(ITEM, PLAYER)]));
		expect(owner.acceptSettings(settings({ [ITEM]: PACK }))?.[ITEM]).toBe(
			PLAYER,
		);
	});

	it("merges late disk history beneath observations, even after the item is equipped", () => {
		const owner = new ClientPackAffinities();
		owner.observe(read([pack(PACK, 0), contained(ITEM, PACK)]));
		owner.observe(read([]));
		const merged = owner.acceptSettings(
			settings({ [ITEM]: OTHER_PACK, 99: OTHER_PACK }),
		);
		expect(merged).toMatchObject({ [ITEM]: PACK, 99: OTHER_PACK });
		if (merged === null) throw new Error("Expected newly observed affinity");
		expect(owner.acceptSettings(settings(merged))).toBeNull();
	});

	it("loads affinity for items already equipped and isolates character switches", () => {
		const owner = new ClientPackAffinities();
		owner.observe(read([]));
		expect(owner.acceptSettings(settings({ [ITEM]: PACK }))).toBeNull();
		expect(owner.storage(read([equipped(ITEM)])).preferred[ITEM]).toBe(PACK);
		const otherPlayer = 10;
		owner.observe(read([], otherPlayer));
		expect(owner.acceptSettings(settings({ [ITEM]: PACK }))).toBeNull();
		expect(owner.storage(read([], otherPlayer)).preferred).toEqual({});
		owner.acceptSettings(settings({ [ITEM]: OTHER_PACK }, otherPlayer));
		expect(
			owner.storage(read([equipped(ITEM, otherPlayer)], otherPlayer)).preferred[
				ITEM
			],
		).toBe(OTHER_PACK);
	});

	it("chooses Main Pack then real carried packs in native order, excluding foci and external storage", () => {
		const owner = new ClientPackAffinities();
		const foci = entityFacts(5, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: PLAYER,
				slot: { kind: "pack", index: 0, entryKind: "foci" },
			},
		});
		const external = entityFacts(6);
		const policy = owner.storage(
			read([
				pack(PACK, 4),
				pack(OTHER_PACK, 1),
				foci,
				external,
				entityFacts(ITEM, {
					location: {
						kind: "contained",
						parentGuid: external.guid,
						slot: { kind: "item", index: 0 },
					},
				}),
			]),
		);
		expect(policy.fallback).toEqual([PLAYER, OTHER_PACK, PACK]);
		expect(policy.preferred[ITEM]).toBeUndefined();
	});

	it("validates item identities and never supplies stale destinations during recovery", () => {
		const owner = new ClientPackAffinities();
		owner.observe(read([contained(ITEM, PLAYER)]));
		expect(owner.storage({ kind: "pending" })).toEqual({
			preferred: {},
			fallback: [],
		});
		expect(
			packAffinitiesSchema.safeParse({ "4294967296": PLAYER }).success,
		).toBe(false);
		expect(packAffinitiesSchema.safeParse({ "01": PLAYER }).success).toBe(
			false,
		);
		expect(packAffinitiesSchema.safeParse({ [ITEM]: 0 }).success).toBe(false);
		owner.reset();
		expect(owner.storage(read([equipped(ITEM)])).preferred).toEqual({});
	});
});
