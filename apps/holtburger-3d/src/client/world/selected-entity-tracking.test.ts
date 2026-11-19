import { baselineCurrentState } from "../session/host-contract.test-support";
import { CASTER_EQUIP_MASK } from "../inventory/inventory-equipment";
import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";
import { describe, expect, it, vi } from "vitest";
import {
	creatureFacts,
	emptyPlayerSummary,
	entityDelta,
	entityFacts,
} from "./entity-mirror.test-support";
import { ClientSelectedEntityTracking } from "./selected-entity-tracking";
import { ClientEntitySelection } from "./entity-selection";
import { ClientLifecycleSession } from "../session/lifecycle-session";

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
	const interactions = new ClientSelectedEntityTracking({
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
	emit(
		"client-current-state",
		baselineCurrentState(1, {
			serverTime: 10,
			worldGeneration: 2,
			worldName: "Leafcull",
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				projectileSupply: { kind: "not-applicable" },
				player: emptyPlayerSummary,
				worldContainer: { kind: "closed" },
				entities: [
					entityFacts(1),
					...[7, 8].map((guid) => creatureFacts(guid)),
					...[9, 10].map((guid, index) =>
						entityFacts(guid, {
							ownedByPlayer: true,
							location: {
								kind: "contained",
								parentGuid: 1,
								slot: { kind: "item", index },
							},
							targeting: "ineligible",
							scenePlacement: "unavailable",
						}),
					),
					entityFacts(11),
				],
			},
		}),
	);
	// Finish session recovery before observing selection-owned commands.
	await vi.waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("set_client_party_updates", {
			enabled: false,
		}),
	);
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

describe("ClientSelectedEntityTracking", () => {
	it("uses a presentation fallback for an unnamed selection", async () => {
		const f = await fixture();
		const item = entityFacts(11);
		if (item.description.kind !== "known")
			throw new Error("Expected known item");
		const unnamed = { ...item, description: { ...item.description, name: "" } };
		f.emit("client-entity-facts-changed", entityDelta({ upserts: [unnamed] }));
		f.selection.select(11);
		expect(f.interactions.display(false).name).toBe("[Unnamed · 0x0000000B]");
		expect(unnamed.description.name).toBe("");
		f.destroy();
	});
	it("keeps ordinary equipment interaction available across equip and unequip confirmations", async () => {
		const f = await fixture();
		const item = entityFacts(11);
		if (item.description.kind !== "known")
			throw new Error("Expected known item");
		f.selection.select(11);
		for (const ownedByPlayer of [true, false]) {
			for (const location of [
				{
					kind: "equipped",
					wearerGuid: ownedByPlayer ? 1 : 9,
					mask: CASTER_EQUIP_MASK,
				},
				{ kind: "contained", parentGuid: 1, slot: { kind: "item", index: 0 } },
			] as const) {
				f.emit(
					"client-entity-facts-changed",
					entityDelta({
						upserts: [
							{
								...item,
								ownedByPlayer,
								location,
								description: {
									...item.description,
									equipLocations: CASTER_EQUIP_MASK,
									useCapability: "unsupported",
								},
							},
						],
					}),
				);
				expect(f.interactions.display(false).canInteract).toBe(ownedByPlayer);
			}
		}
		f.destroy();
	});

	it("honors unrestricted use for an explicit NO without enabling unavailable descriptions", async () => {
		const f = await fixture();
		const item = entityFacts(11);
		if (item.description.kind !== "known")
			throw new Error("Expected known item");
		f.selection.select(11);
		for (const useCapability of ["unsupported", "unavailable"] as const) {
			f.emit(
				"client-entity-facts-changed",
				entityDelta({
					upserts: [
						{ ...item, description: { ...item.description, useCapability } },
					],
				}),
			);
			expect(f.interactions.display(false).canInteract).toBe(false);
			expect(f.interactions.display(true).canInteract).toBe(
				useCapability === "unsupported",
			);
		}
		f.destroy();
	});

	it("enables pickup-only interaction and retires it when eligibility changes", async () => {
		const f = await fixture();
		const item = entityFacts(11);
		if (item.description.kind !== "known")
			throw new Error("Expected known item");
		f.selection.select(11);
		for (const canPickUp of [true, false]) {
			f.emit(
				"client-entity-facts-changed",
				entityDelta({
					upserts: [
						{
							...item,
							canPickUp,
							description: {
								...item.description,
								useCapability: "unsupported",
							},
						},
					],
				}),
			);
			expect(f.interactions.display(false).canInteract).toBe(canPickUp);
		}
		f.destroy();
	});

	it("replaces subscriptions, filters health by GUID, and distinguishes unknown from zero", async () => {
		const f = await fixture();
		const emitHealth = (
			guid: number,
			fraction: number,
			observedAtSeconds: number,
			instanceSequence = 1,
		) =>
			f.emit(
				"client-entity-facts-changed",
				entityDelta({
					upserts: [
						creatureFacts(guid, {
							health: { instanceSequence, fraction, observedAtSeconds },
						}),
					],
				}),
			);
		f.selection.select(7);
		f.selection.select(7);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
		]);
		expect(f.interactions.display(false).health).toEqual({
			kind: "awaiting-response",
		});
		emitHealth(7, 0.4, 1);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 0.4,
		});
		// Re-selecting a previously observed entity still awaits a newer observation.
		f.selection.select(null);
		f.selection.select(7);
		expect(f.interactions.display(false).health).toEqual({
			kind: "awaiting-response",
		});
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 7,
		});
		emitHealth(7, 0.4, 2);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 0.4,
		});
		f.selection.select(8);
		emitHealth(7, 0.2, 3);
		expect(f.interactions.display(false).health).toEqual({
			kind: "awaiting-response",
		});
		emitHealth(8, 0, 4);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 0,
		});
		f.selection.select(null);
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 0,
		});
		expect(f.interactions.display(false).health).toEqual({
			kind: "unavailable",
		});
		f.destroy();
	});

	it("fences stale health across worldGeneration changes and incarnation replacement", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.emit(
			"client-entity-facts-changed",
			entityDelta({
				upserts: [
					creatureFacts(7, {
						health: {
							instanceSequence: 1,
							fraction: 0.75,
							observedAtSeconds: 10,
						},
					}),
				],
			}),
		);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 0.75,
		});

		// Advancing worldGeneration re-queries and gates out the pre-discontinuity sample.
		f.invoke.mockClear();
		f.emit("client-presentation-discontinuity", {
			kind: "forced-reposition",
			worldGeneration: 3,
		});
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
		]);
		expect(f.interactions.display(false).health).toEqual({
			kind: "awaiting-response",
		});

		// A fresh sample in worldGeneration 3 settles the awaiting state.
		f.emit(
			"client-entity-facts-changed",
			entityDelta({
				upserts: [
					creatureFacts(7, {
						health: {
							instanceSequence: 1,
							fraction: 0.6,
							observedAtSeconds: 11,
						},
					}),
				],
			}),
		);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 0.6,
		});

		// Incarnation replacement clears record.health to null and triggers a fresh query.
		f.invoke.mockClear();
		f.emit(
			"client-entity-facts-changed",
			entityDelta({ upserts: [creatureFacts(7)] }),
		);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
		]);
		expect(f.interactions.display(false).health).toEqual({
			kind: "awaiting-response",
		});
		f.emit(
			"client-entity-facts-changed",
			entityDelta({
				upserts: [
					creatureFacts(7, {
						health: { instanceSequence: 2, fraction: 1, observedAtSeconds: 12 },
					}),
				],
			}),
		);
		expect(f.interactions.display(false).health).toEqual({
			kind: "known",
			fraction: 1,
		});
		f.destroy();
	});

	it("queries only eligible selections and cancels once across consecutive inventory items", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.selection.selectContentsItem(9, "toggle");
		expect(f.interactions.display(false)).toEqual({
			name: "Item 9",
			nameColor:
				SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors.other,
			stackCount: null,
			structure: { current: null, max: null },
			health: { kind: "not-applicable" },
			canInteract: true,
			interactionLabel: "Interact",
		});
		f.selection.selectContentsItem(10, "toggle");
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
		expect(f.invoke.mock.calls).toEqual([]);
		f.invoke.mockClear();
		const creature = creatureFacts(
			11,
			{},
			{ name: "Creature", mapCategory: "mob" },
		);
		f.emit("client-entity-facts-changed", entityDelta({ upserts: [creature] }));
		expect(f.interactions.display(false).nameColor).toBe(
			SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors.mob,
		);
		f.emit(
			"client-entity-facts-changed",
			entityDelta({
				upserts: [
					creatureFacts(
						11,
						{
							health: {
								instanceSequence: 1,
								fraction: 0.5,
								observedAtSeconds: 5,
							},
						},
						{ name: "Renamed", mapCategory: "other" },
					),
				],
			}),
		);
		expect(f.interactions.display(false)).toEqual({
			name: "Renamed",
			nameColor:
				SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors.other,
			stackCount: null,
			structure: { current: null, max: null },
			health: { kind: "known", fraction: 0.5 },
			canInteract: true,
			interactionLabel: "Interact",
		});
		f.emit(
			"client-entity-facts-changed",
			entityDelta({ upserts: [entityFacts(11)] }),
		);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 11 }],
			["query_client_entity_health", { guid: 0 }],
		]);
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
		f.emit(
			"client-entity-facts-changed",
			entityDelta({
				upserts: [
					creatureFacts(8, {
						health: {
							instanceSequence: 1,
							fraction: 0.9,
							observedAtSeconds: 6,
						},
					}),
				],
			}),
		);
		expect(f.interactions.display(false).health).toEqual({
			kind: "unavailable",
		});
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 0 }],
		]);
		f.destroy();
	});
});
