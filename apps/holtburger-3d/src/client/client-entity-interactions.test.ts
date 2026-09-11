import { describe, expect, it, vi } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientEntityInteractions } from "./client-entity-interactions";
import { ClientEntitySelection } from "./client-entity-selection";
import { ClientLifecycleSession } from "./client-lifecycle-session";

/** Exercise real selection and lifecycle owners across an injected host transport. */
async function fixture() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const invoke = vi
		.fn<(command: string, args?: Record<string, unknown>) => Promise<void>>()
		.mockResolvedValue(undefined);
	const lifecycle = new ClientLifecycleSession({
		invoke,
		listen: async (name, handler) => {
			handlers.set(name, handler);
			return () => {
				handlers.delete(name);
			};
		},
	});
	const selection = new ClientEntitySelection({
		lifecycle,
		presentation: () => null,
	});
	const onFailure = vi.fn();
	const interactions = new ClientEntityInteractions({
		lifecycle,
		selection,
		onFailure,
	});
	await lifecycle.start();
	function emit(name: string, payload: unknown): void {
		const handler = handlers.get(name);
		if (handler === undefined) throw new Error(`Missing listener: ${name}`);
		handler(payload);
	}
	emit("client-current-state", {
		lifecycle: { kind: "in-world" },
		localPlayerGuid: 1,
		entityCollisionDisabled: false,
		serverTime: 10,
		worldGeneration: 2,
		worldName: "Leafcull",
		playerName: "Player",
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		dynamic: { hostTime: { seconds: 10 }, entities: [] },
		entities: {
			entities: [
				entityFacts(1),
				...[7, 8].map((guid) =>
					entityFacts(guid, {
						description: {
							kind: "known",
							name: `Creature ${guid}`,
							healthQuery: "eligible",
							itemType: 0,
							objectFlags: 0,
							wcid: null,
							weenieType: null,
							pyrealBalance: null,
							stackCount: null,
							icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
						},
					}),
				),
				...[9, 10].map((guid, index) =>
					entityFacts(guid, {
						ownedByPlayer: true,
						location: {
							kind: "contained",
							parentGuid: 1,
							slot: { kind: "item", index },
						},
						scenePlacement: "unavailable",
					}),
				),
				entityFacts(11),
			],
		},
	});
	invoke.mockClear();
	return {
		invoke,
		emit,
		selection,
		interactions,
		onFailure,
		destroy: () => {
			interactions.destroy();
			selection.destroy();
			lifecycle.stop();
		},
	};
}

describe("ClientEntityInteractions", () => {
	it("replaces subscriptions, filters health by GUID, and distinguishes unknown from zero", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.selection.select(7);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
		]);
		expect(f.interactions.display().health).toEqual({
			kind: "awaiting-response",
		});
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.4 });
		expect(f.interactions.display().health).toEqual({
			kind: "known",
			fraction: 0.4,
		});
		f.selection.select(null);
		f.selection.select(7);
		expect(f.interactions.display().health).toEqual({
			kind: "awaiting-response",
		});
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 7,
		});
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.4 });
		expect(f.interactions.display().health).toEqual({
			kind: "known",
			fraction: 0.4,
		});
		f.selection.select(8);
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.2 });
		expect(f.interactions.display().health).toEqual({
			kind: "awaiting-response",
		});
		f.emit("client-entity-health-updated", { guid: 8, healthFraction: 0 });
		expect(f.interactions.display().health).toEqual({
			kind: "known",
			fraction: 0,
		});
		f.selection.select(null);
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 0,
		});
		expect(f.interactions.display().health).toEqual({ kind: "unavailable" });
		f.destroy();
	});

	it("queries only eligible selections and cancels once across consecutive inventory items", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.selection.selectInventoryItem(9);
		expect(f.interactions.display()).toEqual({
			name: "Item 9",
			health: { kind: "not-applicable" },
			canInteract: false,
		});
		f.interactions.interact(false);
		f.selection.selectInventoryItem(10);
		f.selection.select(8);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
			["query_client_entity_health", { guid: 0 }],
			["query_client_entity_health", { guid: 8 }],
		]);
		f.destroy();
	});

	it("reconciles same-GUID eligibility and name changes without duplicate queries", async () => {
		const f = await fixture();
		f.selection.select(11);
		f.interactions.interact(false);
		expect(f.invoke.mock.calls).toEqual([
			["use_client_entity", { guid: 11, unrestricted: false }],
		]);
		f.invoke.mockClear();
		const creature = entityFacts(11, {
			description: {
				kind: "known",
				name: "Creature",
				healthQuery: "eligible",
				itemType: 0,
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: null,
				stackCount: null,
				icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			},
		});
		f.emit("client-entity-facts-changed", { upserts: [creature], removed: [] });
		f.emit("client-entity-health-updated", { guid: 11, healthFraction: 0.5 });
		f.emit("client-entity-facts-changed", {
			upserts: [
				{
					...creature,
					description: {
						...creature.description,
						name: "Renamed",
						kind: "known",
						healthQuery: "eligible",
						itemType: 0,
						objectFlags: 0,
						wcid: null,
						weenieType: null,
						pyrealBalance: null,
						stackCount: null,
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
				},
			],
			removed: [],
		});
		expect(f.interactions.display()).toEqual({
			name: "Renamed",
			health: { kind: "known", fraction: 0.5 },
			canInteract: true,
		});
		f.emit("client-entity-facts-changed", {
			upserts: [entityFacts(11)],
			removed: [],
		});
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 11 }],
			["query_client_entity_health", { guid: 0 }],
		]);
		f.destroy();
	});

	it("uses the target at the button edge and reports command failures", async () => {
		const f = await fixture();
		f.interactions.interact(false);
		expect(f.invoke).not.toHaveBeenCalled();
		f.selection.select(7);
		f.interactions.interact(false);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: false,
		});
		const failure = new Error("transport closed");
		f.invoke.mockRejectedValueOnce(failure);
		f.selection.select(8);
		await vi.waitFor(() => expect(f.onFailure).toHaveBeenCalledWith(failure));
		f.invoke.mockRejectedValueOnce(failure);
		f.interactions.interact(false);
		await vi.waitFor(() => expect(f.onFailure).toHaveBeenCalledTimes(2));
		f.destroy();
	});

	it("captures the explicit unrestricted policy independently for each use", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.interactions.interact(true);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: true,
		});
		f.interactions.interact(false);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: false,
		});
		f.destroy();
	});

	it("cancels on portal entry and does not restore a target on world reentry", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(f.selection.selectedGuid()).toBeNull();
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 0,
		});
		f.invoke.mockClear();
		f.emit("client-lifecycle-changed", { kind: "in-world" });
		f.interactions.interact(false);
		expect(f.invoke).not.toHaveBeenCalled();
		f.destroy();
	});

	it("clears on disconnect without sending commands to a dead session", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.invoke.mockClear();
		f.emit("client-lifecycle-changed", {
			kind: "exiting",
			cause: "server-disconnect",
		});
		expect(f.selection.selectedGuid()).toBeNull();
		f.interactions.interact(false);
		f.destroy();
		expect(f.invoke).not.toHaveBeenCalled();
	});

	it("cancels once on destruction and detaches selection and health listeners", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.invoke.mockClear();
		f.interactions.destroy();
		f.interactions.destroy();
		f.selection.select(8);
		f.emit("client-entity-health-updated", { guid: 8, healthFraction: 0.9 });
		f.interactions.interact(false);
		expect(f.interactions.display().health).toEqual({ kind: "unavailable" });
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 0 }],
		]);
		f.destroy();
	});
});
