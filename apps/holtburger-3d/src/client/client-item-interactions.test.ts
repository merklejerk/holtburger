import { describe, expect, it, vi } from "vitest";
import { ClientItemInteractions } from "./client-item-interactions";
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
	let selected: number | null = null;
	let previous: number | null = null;
	const failure = vi.fn();
	const beginAcquisition = vi.fn();
	const interactions = new ClientItemInteractions({
		session: lifecycle,
		selection: { selectedGuid: () => selected, previousGuid: () => previous },
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
		serverTime: 10,
		worldGeneration: 2,
		worldName: "Test",
		playerName: "Player",
		knownSpells: null,
		appearanceOptions: null,
		combatMode: "peace",
		combat: { desired: null, state: "idle", refill: null },
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		dynamic: { hostTime: { seconds: 10 }, entities: [] },
		entities: {
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
		select: (guid: number | null) => {
			previous = guid === null ? null : selected;
			selected = guid;
		},
		destroy: () => {
			interactions.destroy();
			lifecycle.stop();
		},
	};
}

describe("shared frontend item interaction flow", () => {
	it("casts an equipped item's unlearned spell using the selected target and rejects stale equipment", async () => {
		const f = await fixture();
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
		f.select(null);
		f.interactions.castWieldedSpell(2);
		expect(f.interactions.snapshot().kind).toBe("acquiring");
		f.emit("client-entity-facts-changed", {
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
	it("gives the selected item to the previous recipient and cancels use targeting", async () => {
		const f = await fixture();
		const give = vi
			.spyOn(f.lifecycle, "submitInventory")
			.mockResolvedValue(undefined);
		f.emit("client-entity-facts-changed", {
			worldContainer: null,
			upserts: [entityFacts(4, { canReceiveGive: true })],
			removed: [],
		});
		f.select(4);
		f.select(2);
		f.interactions.use(2, false);
		f.interactions.giveSelected();
		expect(f.interactions.snapshot().kind).toBe("idle");
		expect(give).toHaveBeenCalledExactlyOnceWith({
			item: 2,
			target: { kind: "give", guid: 4 },
		});
		f.emit("client-entity-facts-changed", {
			worldContainer: null,
			upserts: [],
			removed: [4],
		});
		f.interactions.giveSelected();
		expect(give).toHaveBeenCalledTimes(1);
		expect(f.failure).toHaveBeenLastCalledWith(
			"The previous selection cannot receive an item.",
		);
		f.destroy();
	});

	it("picks up loose items before use while preserving active target acquisition", async () => {
		const f = await fixture();
		const inventory = vi
			.spyOn(f.lifecycle, "submitInventory")
			.mockResolvedValue(undefined);
		f.emit("client-entity-facts-changed", {
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
		expect(f.submit).toHaveBeenCalledTimes(1);
		f.select(1);
		f.interactions.respond(state.question.id, true);
		f.interactions.respond(state.question.id, true);
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
			return state.question.id;
		};
		f.interactions.respond(question(), false);
		expect(f.interactions.snapshot().kind).toBe("idle");
		expect(f.submit).toHaveBeenCalledTimes(1);
		const id = question();
		f.emit("client-entity-facts-changed", {
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
