import { emptyHousing } from "./client-housing-contract";
import { describe, expect, it, vi } from "vitest";
import {
	ClientItemInteractions,
	GIVE_CONFIRMATION_SUPPRESSION_MS,
} from "./client-item-interactions";
import { ClientEntitySelection } from "./client-entity-selection";
import { CASTER_EQUIP_MASK } from "./client-inventory-equipment";
import { ClientLifecycleSession } from "./client-lifecycle-session";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientEntityFacts } from "./client-entity-mirror";
import type { ClientItemUseResult } from "./client-item-use-contract";

async function fixture() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const lifecycle = new ClientLifecycleSession({
		invoke: vi.fn().mockResolvedValue(undefined),
		listen: async (name, handler) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
	});
	const selection = new ClientEntitySelection({
		lifecycle,
		presentation: () => null,
	});
	const failure = vi.fn();
	const beginAcquisition = vi.fn();
	const beginTrade = vi.fn();
	const interactions = new ClientItemInteractions({
		beginTrade,
		session: lifecycle,
		selection,
		reportFailure: failure,
		reportNotice: failure,
		beginAcquisition,
	});
	await lifecycle.start();
	const source = entityFacts(2, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: 1,
			slot: { kind: "item", index: 0 },
		},
	});
	if (source.description.kind !== "known")
		throw new Error("Known fixture required");
	const targeted: ClientEntityFacts = {
		...source,
		description: { ...source.description, useCapability: "targeted" },
	};
	const emit = (name: string, payload: unknown) => {
		const handler = handlers.get(name);
		if (handler === undefined) throw new Error("Missing listener " + name);
		handler(payload);
	};
	emit("client-current-state", {
		lifecycle: { kind: "in-world" },
		localPlayerGuid: 1,
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		serverTime: 10,
		worldGeneration: 2,
		connection: null,
		worldName: "Test",
		playerName: "Player",
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		party: null,
		partyPreferences: null,
		friends: null,
		contracts: null,
		squelch: null,
		allegiance: {
			playerGuid: null,
			profile: null,
			refreshing: false,
			canSwear: false,
		},
		allegiancePreferences: null,
		friendsPreferences: null,
		combatMode: "peace",
		combat: { desired: null, state: "idle", refill: null },
		vitals: [],
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		characterMotion: null,
		activeConfirmation: null,
		dynamic: { hostTime: { seconds: 10 }, entities: [] },
		entities: {
			projectileSupply: { kind: "not-applicable" },
			worldContainer: { kind: "closed" },
			entities: [
				entityFacts(1),
				targeted,
				entityFacts(3, {
					ownedByPlayer: true,
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "item", index: 1 },
					},
				}),
			],
		},
	});
	const submit = vi
		.spyOn(lifecycle, "submitItemUse")
		.mockResolvedValue(undefined);
	const query = vi
		.spyOn(lifecycle, "queryItemUseTarget")
		.mockResolvedValue(undefined);
	const request = () => {
		const call = submit.mock.calls.at(-1);
		if (call === undefined) throw new Error("Expected a request");
		return call[0];
	};
	const result = (outcome: ClientItemUseResult["outcome"]) =>
		emit("client-item-use-result", { sequence: request().sequence, outcome });
	return {
		interactions,
		lifecycle,
		failure,
		beginAcquisition,
		beginTrade,
		submit,
		query,
		request,
		result,
		resolveTarget: (eligible: boolean) => {
			const state = interactions.snapshot();
			if (state.kind !== "resolving")
				throw new Error("Expected automatic target resolution");
			emit("client-item-use-target-result", {
				sequence: state.sequence,
				eligible,
			});
		},
		emit,
		selection,
		select: (guid: number | null) => selection.select(guid),
		destroy: () => {
			interactions.destroy();
			selection.destroy();
			lifecycle.stop();
		},
	};
}

describe("shared frontend item interaction flow", () => {
	it("shares state-based equipment interaction across inventory, selection, and action cells", async () => {
		const f = await fixture();
		const inventory = vi.spyOn(f.lifecycle, "submitInventory");
		const equip = vi
			.spyOn(f.lifecycle, "equipItem")
			.mockResolvedValue(undefined);
		const source = entityFacts(2, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index: 0 },
			},
		});
		if (source.description.kind !== "known")
			throw new Error("Known fixture required");
		const equipment: ClientEntityFacts = {
			...source,
			description: {
				...source.description,
				equipLocations: CASTER_EQUIP_MASK,
				useCapability: "targeted",
			},
		};
		const publish = (item: ClientEntityFacts) =>
			f.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: [item],
				removed: [],
			});
		publish(equipment);
		f.interactions.use(2, false);
		f.select(2);
		f.interactions.interactSelected(false);
		f.interactions.activate(2, "equipment", false);
		f.interactions.activate(2, "equipment", true);
		expect(equip.mock.calls).toEqual([
			[2, false],
			[2, false],
			[2, false],
			[2, true],
		]);
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.interactions.snapshot().kind).toBe("idle");
		publish({
			...equipment,
			location: { kind: "equipped", wearerGuid: 1, mask: CASTER_EQUIP_MASK },
		});
		f.interactions.use(2, false);
		f.interactions.interactSelected(false);
		f.interactions.activate(2, "equipment", false);
		f.interactions.activate(2, "equipment", true);
		expect(equip).toHaveBeenCalledTimes(4);
		expect(inventory.mock.calls).toEqual([
			[{ item: 2, target: { kind: "unequip" } }],
			[{ item: 2, target: { kind: "unequip" } }],
			[{ item: 2, target: { kind: "unequip" } }],
			[{ item: 2, target: { kind: "unequip" } }],
		]);
		expect(f.interactions.snapshot().kind).toBe("idle");
		f.interactions.use(2, true);
		expect(f.interactions.snapshot().kind).toBe("acquiring");
		f.destroy();
	});

	it("unequips non-usable armor but keeps equipped targeting recipients and other wearers intact", async () => {
		const f = await fixture();
		const inventory = vi.spyOn(f.lifecycle, "submitInventory");
		const armor = entityFacts(3);
		if (armor.description.kind !== "known")
			throw new Error("Known fixture required");
		const publish = (ownedByPlayer: boolean, wearerGuid: number) =>
			f.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: [
					{
						...armor,
						ownedByPlayer,
						location: { kind: "equipped", wearerGuid, mask: CASTER_EQUIP_MASK },
						description: { ...armor.description, useCapability: "unsupported" },
					},
				],
				removed: [],
			});
		publish(true, 1);
		f.interactions.use(3, false);
		expect(inventory).toHaveBeenCalledWith({
			item: 3,
			target: { kind: "unequip" },
		});
		inventory.mockClear();
		f.interactions.use(2, false);
		f.select(3);
		f.interactions.interactSelected(false);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		expect(inventory).not.toHaveBeenCalled();
		publish(false, 9);
		f.interactions.use(3, false);
		expect(inventory).not.toHaveBeenCalled();
		expect(f.failure).toHaveBeenCalledWith(
			"This item cannot currently be used.",
		);
		f.destroy();
	});

	it("casts an equipped item's unlearned spell using the selected target and rejects stale equipment", async () => {
		const f = await fixture();
		const inventory = vi.spyOn(f.lifecycle, "submitInventory");
		const source = entityFacts(2);
		if (source.description.kind !== "known")
			throw new Error("Known fixture required");
		const caster: ClientEntityFacts = {
			...source,
			ownedByPlayer: true,
			location: { kind: "equipped", wearerGuid: 1, mask: CASTER_EQUIP_MASK },
			description: {
				...source.description,
				builtInSpell: 42,
				equipLocations: CASTER_EQUIP_MASK,
				useCapability: "targeted",
			},
		};
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [caster],
			removed: [],
		});
		f.emit("client-player-spells-updated", { spellIds: [] });
		f.select(3);
		f.interactions.castWieldedSpell(2);
		expect(f.query).not.toHaveBeenCalled();
		expect(f.failure).toHaveBeenLastCalledWith(
			"Enter magic stance before casting.",
		);
		f.emit("client-combat-mode-updated", { mode: "magic" });
		f.interactions.castWieldedSpell(2);
		expect(f.query).toHaveBeenCalledWith({
			sequence: expect.any(Number),
			source: 2,
			target: 3,
		});
		f.resolveTarget(true);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		f.result({ kind: "executed" });
		f.interactions.castWieldedSpell(2);
		f.resolveTarget(false);
		expect(f.interactions.snapshot().kind).toBe("acquiring");
		f.select(null);
		f.interactions.castWieldedSpell(2);
		expect(f.interactions.snapshot().kind).toBe("acquiring");
		expect(inventory).not.toHaveBeenCalled();
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [
				{
					...caster,
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "item", index: 0 },
					},
				},
			],
			removed: [],
		});
		f.interactions.castWieldedSpell(2);
		expect(f.failure).toHaveBeenLastCalledWith(
			"The caster spell is no longer wielded.",
		);
		expect(f.submit).toHaveBeenCalledTimes(1);
		f.destroy();
	});
	it("confirms keyboard gives and restores the recipient for consecutive hand-ins", async () => {
		const f = await giveFixture();
		f.select(4);
		f.select(2);
		f.interactions.use(2, false);
		f.interactions.giveSelected();
		expect(f.give).not.toHaveBeenCalled();
		expect(f.interactions.question()).toMatchObject({
			acceptLabel: "Give",
			cancelLabel: "Cancel",
		});
		const question = f.question();
		f.interactions.respond(question.requestId, true);
		expect(f.give).toHaveBeenCalledExactlyOnceWith({
			item: 2,
			target: { kind: "give", guid: 4 },
		});
		expect(f.selection.selectedGuid()).toBe(4);
		f.select(3);
		f.interactions.giveSelected();
		f.interactions.respond(f.question().requestId, true);
		expect(f.give).toHaveBeenLastCalledWith({
			item: 3,
			target: { kind: "give", guid: 4 },
		});
		expect(f.selection.selectedGuid()).toBe(4);
		f.destroy();
	});

	it("keeps direct give identities while selection changes and ignores repeated acceptance", async () => {
		const f = await giveFixture();
		f.select(2);
		f.interactions.give(2, 4);
		const question = f.question();
		f.select(5);
		f.interactions.respond(question.requestId, true);
		f.interactions.respond(question.requestId, true);
		expect(f.give).toHaveBeenCalledExactlyOnceWith({
			item: 2,
			target: { kind: "give", guid: 4 },
		});
		expect(f.selection.selectedGuid()).toBe(4);
		f.destroy();
	});

	it("cancels without enabling suppression or changing selection", async () => {
		const f = await giveFixture();
		f.select(2);
		f.interactions.give(2, 4);
		f.interactions.respond(f.question().requestId, false, true);
		expect(f.give).not.toHaveBeenCalled();
		expect(f.selection.selectedGuid()).toBe(2);
		f.interactions.give(2, 5);
		expect(f.interactions.question()).not.toBeNull();
		f.destroy();
	});

	it("suppresses all recipients for one hour without extending the deadline on subsequent gives", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const f = await giveFixture();
		try {
			f.interactions.give(2, 4);
			f.interactions.respond(f.question().requestId, true, true);
			now.mockReturnValue(1_000 + GIVE_CONFIRMATION_SUPPRESSION_MS - 1);
			f.select(3);
			f.interactions.give(3, 5);
			expect(f.interactions.question()).toBeNull();
			expect(f.give).toHaveBeenLastCalledWith({
				item: 3,
				target: { kind: "give", guid: 5 },
			});
			now.mockReturnValue(1_000 + GIVE_CONFIRMATION_SUPPRESSION_MS);
			f.interactions.give(2, 4);
			expect(f.interactions.question()).not.toBeNull();
			expect(f.give).toHaveBeenCalledTimes(2);
		} finally {
			now.mockRestore();
			f.destroy();
		}
	});

	it("retains suppression through portals and clears it on logout", async () => {
		const f = await giveFixture();
		f.interactions.give(2, 4);
		f.interactions.respond(f.question().requestId, true, true);
		f.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		f.emit("client-lifecycle-changed", { kind: "in-world" });
		f.interactions.give(2, 5);
		expect(f.interactions.question()).toBeNull();
		expect(f.give).toHaveBeenCalledTimes(2);
		f.emit("client-lifecycle-changed", {
			kind: "character-selection",
			characters: [],
		});
		f.emit("client-lifecycle-changed", { kind: "in-world" });
		f.interactions.give(2, 4);
		expect(f.interactions.question()).not.toBeNull();
		expect(f.give).toHaveBeenCalledTimes(2);
		f.destroy();
	});

	it("reports invalid recipients and submission failures", async () => {
		const f = await giveFixture();
		f.interactions.give(2, 99);
		expect(f.failure).toHaveBeenLastCalledWith(
			"This recipient cannot receive an item.",
		);
		expect(f.interactions.question()).toBeNull();
		f.give.mockRejectedValueOnce(new Error("Give rejected"));
		f.interactions.give(2, 4);
		f.interactions.respond(f.question().requestId, true);
		await Promise.resolve();
		expect(f.failure).toHaveBeenLastCalledWith("Error: Give rejected");
		f.destroy();
	});

	it("picks up loose items before use while preserving active target acquisition", async () => {
		const f = await fixture();
		const inventory = vi
			.spyOn(f.lifecycle, "submitInventory")
			.mockResolvedValue(undefined);
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [entityFacts(4, { canPickUp: true })],
			removed: [],
		});
		f.select(4);
		f.interactions.interactSelected(false);
		expect(inventory).toHaveBeenCalledExactlyOnceWith({
			item: 4,
			target: { kind: "pickup", container: null },
		});
		expect(f.submit).not.toHaveBeenCalled();
		f.interactions.use(2, false);
		f.interactions.interactSelected(false);
		expect(inventory).toHaveBeenCalledTimes(1);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 4,
		});
		f.destroy();
	});

	it("uses an owned item normally and reports pickup submission failures", async () => {
		const f = await fixture();
		f.select(3);
		f.interactions.interactSelected(false);
		expect(f.request().intent).toEqual({
			kind: "direct",
			source: 3,
			unrestricted: false,
		});
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [entityFacts(4, { canPickUp: true })],
			removed: [],
		});
		vi.spyOn(f.lifecycle, "submitInventory").mockRejectedValue(
			new Error("Disconnected"),
		);
		f.select(4);
		f.interactions.interactSelected(false);
		await Promise.resolve();
		expect(f.failure).toHaveBeenCalledWith("Error: Disconnected");
		f.destroy();
	});

	it("acquires targets for ordinary use but supplies self or selection for action bars", async () => {
		const f = await fixture();
		f.interactions.use(2, false);
		const state = f.interactions.snapshot();
		expect(state.kind).toBe("acquiring");
		expect(f.submit).not.toHaveBeenCalled();
		if (state.kind !== "acquiring") throw new Error("Expected acquisition");
		f.interactions.target(3, state.generation);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		f.result({ kind: "rejected", reason: "Invalid target" });
		expect(f.interactions.snapshot()).toMatchObject({
			kind: "acquiring",
			source: state.source,
		});
		expect(f.interactions.target(3, state.generation)).toBe(false);
		f.interactions.activate(2, "targeted", false);
		f.resolveTarget(true);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 1,
		});
		f.select(3);
		f.interactions.activate(2, "targeted", true);
		f.resolveTarget(true);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		const count = f.submit.mock.calls.length;
		f.select(null);
		f.interactions.activate(2, "targeted", true);
		expect(f.submit).toHaveBeenCalledTimes(count);
		expect(f.interactions.snapshot().kind).toBe("acquiring");
		f.destroy();
	});

	it("falls back to explicit targeting for incompatible automatic targets and ignores cancelled checks", async () => {
		const f = await fixture();
		f.interactions.activate(2, "targeted", false);
		expect(f.query).toHaveBeenLastCalledWith(
			expect.objectContaining({ source: 2, target: 1 }),
		);
		expect(f.submit).not.toHaveBeenCalled();
		f.resolveTarget(false);
		expect(f.interactions.snapshot()).toMatchObject({
			kind: "acquiring",
			source: 2,
		});
		f.select(3);
		f.interactions.activate(2, "targeted", true);
		f.resolveTarget(false);
		expect(f.interactions.snapshot()).toMatchObject({
			kind: "acquiring",
			source: 2,
		});
		expect(f.beginAcquisition).toHaveBeenCalledTimes(2);
		f.interactions.activate(2, "targeted", true);
		const pending = f.interactions.snapshot();
		if (pending.kind !== "resolving") throw new Error("Expected resolution");
		f.interactions.cancel();
		f.emit("client-item-use-target-result", {
			sequence: pending.sequence,
			eligible: true,
		});
		expect(f.interactions.snapshot().kind).toBe("idle");
		expect(f.submit).not.toHaveBeenCalled();
		f.destroy();
	});

	it("captures the selection at activation while checking eligibility", async () => {
		const f = await fixture();
		f.select(3);
		f.interactions.activate(2, "targeted", true);
		f.select(1);
		f.resolveTarget(true);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		f.destroy();
	});

	it.each(["result", "transport"] as const)(
		"does not revive cancelled targeting after a %s rejection",
		async (failure) => {
			const f = await fixture();
			if (failure === "transport")
				f.submit.mockRejectedValueOnce(new Error("Use rejected"));
			f.interactions.use(2, false);
			const acquisition = f.interactions.snapshot();
			if (acquisition.kind !== "acquiring")
				throw new Error("Expected acquisition");
			f.interactions.target(3, acquisition.generation);
			f.interactions.cancelTargeting();
			expect(f.interactions.snapshot()).toMatchObject({
				kind: "submitting",
				resume: null,
			});
			if (failure === "result")
				f.result({ kind: "rejected", reason: "Use rejected" });
			else await Promise.resolve();
			expect(f.interactions.snapshot().kind).toBe("idle");
			expect(f.failure).toHaveBeenCalled();
			f.destroy();
		},
	);

	it("queries hover eligibility without use and ignores replies for departed targets", async () => {
		const f = await fixture();
		f.interactions.use(2, false);
		f.interactions.consider(3);
		const first = f.query.mock.calls.at(-1)?.[0];
		if (!first) throw new Error("Expected target query");
		f.interactions.consider(3);
		expect(f.query).toHaveBeenCalledTimes(1);
		f.interactions.consider(1);
		const second = f.query.mock.calls.at(-1)?.[0];
		if (!second) throw new Error("Expected self query");
		expect(second.target).toBe(1);
		f.emit("client-item-use-target-result", {
			sequence: first.sequence,
			eligible: true,
		});
		expect(f.interactions.snapshot()).toMatchObject({
			considered: { target: 1, eligibility: "pending" },
		});
		f.emit("client-item-use-target-result", {
			sequence: second.sequence,
			eligible: false,
		});
		expect(f.interactions.snapshot()).toMatchObject({
			considered: { target: 1, eligibility: "ineligible" },
		});
		f.interactions.consider(null);
		f.emit("client-item-use-target-result", {
			sequence: second.sequence,
			eligible: true,
		});
		expect(f.interactions.snapshot()).toMatchObject({ considered: null });
		expect(f.submit).not.toHaveBeenCalled();
		f.destroy();
	});

	it("owns destructive approval locally and submits the displayed target only once", async () => {
		const f = await fixture();
		f.select(3);
		f.interactions.activate(2, "targeted", true);
		f.resolveTarget(true);
		f.result({
			kind: "consequence-changed",
			evaluation: { kind: "destroy-item", target: 3, amount: 1, name: "Armor" },
		});
		const state = f.interactions.snapshot();
		if (state.kind !== "confirming") throw new Error("Expected local question");
		expect(f.interactions.question()).toEqual({
			requestId: state.question.requestId,
			text: state.question.text,
		});
		expect(f.submit).toHaveBeenCalledTimes(1);
		f.select(1);
		f.interactions.respond(state.question.requestId, true);
		f.interactions.respond(state.question.requestId, true);
		expect(f.submit).toHaveBeenCalledTimes(2);
		expect(f.request().intent).toEqual({
			kind: "targeted",
			source: 2,
			target: 3,
		});
		expect(f.request().expected).toEqual({
			kind: "destroy-item",
			target: 3,
			amount: 1,
		});
		f.result({ kind: "consequence-changed", evaluation: { kind: "ordinary" } });
		expect(f.interactions.snapshot().kind).toBe("idle");
		expect(f.submit).toHaveBeenCalledTimes(2);
		f.destroy();
	});

	it("declines locally and retires approval when the source disappears", async () => {
		const f = await fixture();
		const question = () => {
			f.select(3);
			f.interactions.activate(2, "targeted", true);
			f.resolveTarget(true);
			f.result({
				kind: "consequence-changed",
				evaluation: {
					kind: "destroy-item",
					target: 3,
					amount: 1,
					name: "Armor",
				},
			});
			const state = f.interactions.snapshot();
			if (state.kind !== "confirming") throw new Error("Expected question");
			return state.question.requestId;
		};
		f.interactions.respond(question(), false);
		expect(f.interactions.snapshot().kind).toBe("idle");
		expect(f.submit).toHaveBeenCalledTimes(1);
		const id = question();
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [],
			removed: [2],
		});
		expect(f.interactions.snapshot().kind).toBe("idle");
		f.interactions.respond(id, true);
		expect(f.submit).toHaveBeenCalledTimes(2);
		f.destroy();
	});

	it("ignores cancelled pick/results and cancels local questions for server confirmations", async () => {
		const f = await fixture();
		f.interactions.use(2, false);
		const state = f.interactions.snapshot();
		if (state.kind !== "acquiring") throw new Error("Expected acquisition");
		f.interactions.cancel();
		expect(f.interactions.target(3, state.generation)).toBe(false);
		f.interactions.activate(2, "targeted", false);
		f.resolveTarget(true);
		f.interactions.cancel();
		f.result({
			kind: "consequence-changed",
			evaluation: { kind: "destroy-item", target: 3, amount: 1, name: "Armor" },
		});
		expect(f.interactions.snapshot().kind).toBe("idle");
		f.interactions.activate(2, "targeted", false);
		f.resolveTarget(true);
		f.result({
			kind: "consequence-changed",
			evaluation: { kind: "destroy-item", target: 3, amount: 1, name: "Armor" },
		});
		f.emit("client-confirmation-updated", {
			confirmation: { requestId: "1", text: "Server question" },
		});
		expect(f.interactions.snapshot().kind).toBe("idle");
		f.destroy();
	});
});

it("player interaction initiates trade through the ordinary Interact flow", async () => {
	const f = await fixture();
	f.emit("client-entity-facts-changed", {
		projectileSupply: null,
		worldContainer: null,
		removed: [],
		upserts: [entityFacts(7, { canTrade: true })],
	});
	f.select(7);
	f.interactions.interactSelected(false);
	expect(f.beginTrade).toHaveBeenCalledWith(7);
	expect(f.submit).not.toHaveBeenCalled();
	expect(f.interactions.snapshot().kind).toBe("idle");
	f.destroy();
});

/** Two recipient kinds share the same give policy and suppression deadline. */
async function giveFixture() {
	const f = await fixture();
	const give = vi
		.spyOn(f.lifecycle, "submitInventory")
		.mockResolvedValue(undefined);
	f.emit("client-entity-facts-changed", {
		projectileSupply: null,
		worldContainer: null,
		upserts: [
			entityFacts(4, { canReceiveGive: true }),
			entityFacts(5, { canReceiveGive: true, canTrade: true }),
		],
		removed: [],
	});
	return {
		...f,
		give,
		question: () => {
			const question = f.interactions.question();
			if (question === null) throw new Error("Expected give confirmation");
			return question;
		},
	};
}
