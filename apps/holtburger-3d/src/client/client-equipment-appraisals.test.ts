import { describe, expect, it, vi } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";
import type { EquipmentCantripState } from "../app/item-cantrip-contract.js";
import type {
	AppraisalRequest,
	FactsAppraisalPriority,
} from "./client-appraisal-requests";
import type {
	EquipmentCacheEntry,
	EquipmentCacheSnapshot,
} from "./client-equipment-cache-contract";
import {
	ClientEquipmentAppraisals,
	type ClientEquipmentAppraisalSession,
	type ClientEquipmentAppraisalSessionEvent,
} from "./client-equipment-appraisals";
import type { ClientLifecycleSessionState } from "./client-lifecycle-session";

function makeEquipment(
	guid: number,
	{
		owned = true,
		worldContainerContent = false,
		cantrip = { kind: "unappraised" } as EquipmentCantripState | null,
	} = {},
): ClientEntityFacts {
	const base = entityFacts(guid);
	return {
		...base,
		ownedByPlayer: owned,
		worldContainerContent,
		description: {
			...(base.description as Extract<
				ClientEntityFacts["description"],
				{ kind: "known" }
			>),
			equipmentCantrip: cantrip,
		},
	};
}

function createFakeSession(initialRecords: readonly ClientEntityFacts[] = []) {
	const entities = new Map<number, ClientEntityFacts>(
		initialRecords.map((record) => [record.guid, record]),
	);
	const listeners = new Set<
		(event: ClientEquipmentAppraisalSessionEvent) => void
	>();
	const cancels = new Map<number, ReturnType<typeof vi.fn>>();
	const settles = new Map<number, ReturnType<typeof vi.fn>>();
	const requestedFacts: {
		readonly guid: number;
		readonly priority: FactsAppraisalPriority | undefined;
	}[] = [];
	let lifecycle: ClientLifecycleSessionState["lifecycle"] = {
		kind: "in-world",
	};
	let partnerItems: number[] = [];
	let vendorOffers:
		| {
				guid: number;
				equipment_cantrip: EquipmentCantripState | null;
		  }[]
		| null = null;

	const session: ClientEquipmentAppraisalSession = {
		entities: {
			read(): ClientEntityRead {
				return {
					kind: "current",
					level: {
						worldGeneration: 1,
						playerGuid: 1,
						entities,
					} as unknown as Extract<
						ClientEntityRead,
						{ kind: "current" }
					>["level"],
				};
			},
		},
		appraisals: {
			requestFacts(
				guid: number,
				priority?: FactsAppraisalPriority,
			): AppraisalRequest {
				requestedFacts.push({ guid, priority });
				const cancel = vi.fn();
				const settle = vi.fn();
				cancels.set(guid, cancel);
				settles.set(guid, settle);
				return {
					sent: Promise.resolve(),
					cancel,
					settle,
				};
			},
		},
		state: () => ({ lifecycle }),
		tradeSnapshot: () => ({
			trade:
				partnerItems.length === 0
					? null
					: { partner_side: { items: partnerItems } },
		}),
		vendorSnapshot: () =>
			vendorOffers === null ? null : { offers: vendorOffers },
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};

	const emit = (type = "entities") => {
		for (const listener of listeners) listener({ type });
	};
	const emitEvent = (event: ClientEquipmentAppraisalSessionEvent) => {
		for (const listener of listeners) listener(event);
	};

	return {
		session,
		entities,
		requestedFacts,
		cancels,
		settles,
		emit,
		emitEvent,
		setLifecycle: (next: ClientLifecycleSessionState["lifecycle"]) => {
			lifecycle = next;
		},
		setPartnerTradeItems: (items: number[]) => {
			partnerItems = items;
		},
		setVendorOffers: (
			offers:
				| { guid: number; equipment_cantrip: EquipmentCantripState | null }[]
				| null,
		) => {
			vendorOffers = offers;
		},
	};
}

describe("ClientEquipmentAppraisals", () => {
	it("waits for cache load, shows cached/known tiers regardless of ownership, and only persists owned items", async () => {
		let resolveCache!: (snapshot: EquipmentCacheSnapshot) => void;
		const staged: EquipmentCacheEntry[] = [];
		const transport = {
			readAll: () =>
				new Promise<EquipmentCacheSnapshot>((resolve) => {
					resolveCache = resolve;
				}),
			stage: (entry: EquipmentCacheEntry) => staged.push(entry),
			listenFailures: () => () => undefined,
		};

		const { session, entities, requestedFacts, cancels, settles, emit } =
			createFakeSession([
				makeEquipment(10, { cantrip: { kind: "unappraised" } }), // cached legendary
				makeEquipment(11, { cantrip: { kind: "unappraised" } }), // cached null (confirmed none)
				makeEquipment(12, { cantrip: { kind: "unappraised" } }), // cache miss
				makeEquipment(13, { cantrip: null }), // non-equipment
				makeEquipment(14, { owned: false, cantrip: { kind: "unappraised" } }), // unowned passive cache hit
				makeEquipment(15, { owned: false, cantrip: { kind: "unappraised" } }), // unowned passive miss
			]);

		const onChange = vi.fn();
		const owner = new ClientEquipmentAppraisals(session, transport, onChange);

		// Before disk cache finishes loading, zero IdentifyObject requests should be sent.
		expect(requestedFacts).toEqual([]);
		expect(owner.tierFor(10)).toBeUndefined();

		resolveCache({ "10": "legendary", "11": null, "14": "major" });
		await Promise.resolve();
		await Promise.resolve();

		expect(owner.tierFor(10)).toBe("legendary");
		expect(owner.tierFor(11)).toBeUndefined();
		expect(owner.tierFor(12)).toBeUndefined();
		expect(owner.tierFor(13)).toBeUndefined();
		expect(owner.tierFor(14)).toBe("major");
		expect(owner.tierFor(15)).toBeUndefined();
		expect(requestedFacts).toEqual([
			{ guid: 12, priority: { kind: "owned-equipment" } },
		]);
		expect(staged).toEqual([]);
		expect(onChange).toHaveBeenCalledTimes(1);

		// When live resolution arrives for 12, it settles locally (not cancel), updates the tier, and stages to disk cache.
		entities.set(
			12,
			makeEquipment(12, {
				cantrip: { kind: "known", highestTier: "epic" },
			}),
		);
		emit("entities");
		expect(owner.tierFor(12)).toBe("epic");
		expect(staged).toEqual([{ guid: 12, highestTier: "epic" }]);
		expect(settles.get(12)).toHaveBeenCalledTimes(1);
		expect(cancels.get(12)).not.toHaveBeenCalled();
		expect(onChange).toHaveBeenCalledTimes(2);

		// Dropping / un-owning an item preserves its visible known tier without firing requests.
		entities.set(
			12,
			makeEquipment(12, {
				owned: false,
				cantrip: { kind: "known", highestTier: "epic" },
			}),
		);
		emit("entities");
		expect(owner.tierFor(12)).toBe("epic");
		expect(cancels.get(12)).not.toHaveBeenCalled();

		owner.destroy();
	});

	it("auto-polls open world containers, partner trades, and vendor offers in priority order without persisting unowned gear", async () => {
		const staged: EquipmentCacheEntry[] = [];
		const transport = {
			readAll: async () => ({}),
			stage: (entry: EquipmentCacheEntry) => staged.push(entry),
			listenFailures: () => () => undefined,
		};

		const {
			session,
			entities,
			requestedFacts,
			cancels,
			emit,
			setPartnerTradeItems,
			setVendorOffers,
		} = createFakeSession([
			makeEquipment(30, {
				owned: false,
				worldContainerContent: true,
				cantrip: { kind: "unappraised" },
			}),
			makeEquipment(31, {
				owned: false,
				cantrip: { kind: "unappraised" },
			}),
			makeEquipment(32, {
				owned: true,
				cantrip: { kind: "unappraised" },
			}),
		]);
		setPartnerTradeItems([31]);
		setVendorOffers([
			{ guid: 40, equipment_cantrip: { kind: "unappraised" } },
			{ guid: 41, equipment_cantrip: { kind: "known", highestTier: "minor" } },
			{ guid: 42, equipment_cantrip: null },
		]);

		const owner = new ClientEquipmentAppraisals(session, transport);
		await Promise.resolve();
		await Promise.resolve();

		// Priority order: world container (30) -> owned (32) -> partner trade (31) -> vendor catalog (40).
		expect(requestedFacts).toEqual([
			{ guid: 30, priority: { kind: "world-container" } },
			{ guid: 32, priority: { kind: "owned-equipment" } },
			{ guid: 31, priority: { kind: "partner-trade" } },
			{ guid: 40, priority: { kind: "vendor-offer" } },
		]);
		expect(owner.tierFor(41)).toBe("minor");
		expect(staged).toEqual([]);

		// Resolving a container item shows it immediately without staging to disk until owned.
		entities.set(
			30,
			makeEquipment(30, {
				owned: false,
				worldContainerContent: true,
				cantrip: { kind: "known", highestTier: "major" },
			}),
		);
		emit("entities");
		expect(owner.tierFor(30)).toBe("major");
		expect(staged).toEqual([]);

		// Looting item 30 later stages it to disk once owned.
		entities.set(
			30,
			makeEquipment(30, {
				owned: true,
				worldContainerContent: false,
				cantrip: { kind: "known", highestTier: "major" },
			}),
		);
		emit("entities");
		expect(staged).toEqual([{ guid: 30, highestTier: "major" }]);

		// Partner trade withdraw + vendor close cancels pending FactsOnly requests for those scopes.
		setPartnerTradeItems([]);
		emit("trade-snapshot");
		expect(cancels.get(31)).toHaveBeenCalledTimes(1);

		setVendorOffers(null);
		emit("vendor-snapshot");
		expect(cancels.get(40)).toHaveBeenCalledTimes(1);
		expect(owner.tierFor(41)).toBeUndefined();

		owner.destroy();
	});

	it("cancels pending facts requests when unappraised equipment disappears and never caches incomplete spells", async () => {
		const staged: EquipmentCacheEntry[] = [];
		const transport = {
			readAll: async () => ({}),
			stage: (entry: EquipmentCacheEntry) => staged.push(entry),
			listenFailures: () => () => undefined,
		};

		const { session, entities, requestedFacts, cancels, settles, emit } =
			createFakeSession([
				makeEquipment(20, { cantrip: { kind: "unappraised" } }),
				makeEquipment(21, { cantrip: { kind: "unappraised" } }),
			]);
		const owner = new ClientEquipmentAppraisals(session, transport);
		await Promise.resolve();
		await Promise.resolve();
		expect(requestedFacts).toEqual([
			{ guid: 20, priority: { kind: "owned-equipment" } },
			{ guid: 21, priority: { kind: "owned-equipment" } },
		]);

		// Item 20 arrives incomplete (missing spell catalog entry) -> settles locally, never cached.
		entities.set(20, makeEquipment(20, { cantrip: { kind: "incomplete" } }));
		// Item 21 disappears from inventory -> cancels pending FactsOnly request.
		entities.delete(21);
		emit("entities");

		expect(owner.tierFor(20)).toBeUndefined();
		expect(staged).toEqual([]);
		expect(settles.get(20)).toHaveBeenCalledTimes(1);
		expect(cancels.get(20)).not.toHaveBeenCalled();
		expect(cancels.get(21)).toHaveBeenCalledTimes(1);
		expect(settles.get(21)).not.toHaveBeenCalled();

		owner.destroy();
	});

	it("retains visible tiers across teleport portal-space, suppresses portal polling, and re-polls after return or resync", async () => {
		const transport = {
			readAll: async () => ({}),
			stage: () => undefined,
			listenFailures: () => () => undefined,
		};

		const {
			session,
			entities,
			requestedFacts,
			cancels,
			emit,
			emitEvent,
			setLifecycle,
		} = createFakeSession([
			makeEquipment(50, {
				cantrip: { kind: "known", highestTier: "legendary" },
			}),
			makeEquipment(51, { cantrip: { kind: "unappraised" } }),
		]);
		const owner = new ClientEquipmentAppraisals(session, transport);
		await Promise.resolve();
		await Promise.resolve();

		expect(owner.tierFor(50)).toBe("legendary");
		expect(requestedFacts).toEqual([
			{ guid: 51, priority: { kind: "owned-equipment" } },
		]);

		// Core settling a background appraisal without changing entity cantrip state clears pending tracking
		// without immediately re-polling the attempted miss in the same world stay.
		emitEvent({ type: "appraisal-facts-settled", guid: 51 });
		emit("entities");
		expect(requestedFacts).toHaveLength(1);
		expect(cancels.get(51)).not.toHaveBeenCalled();

		// Queue another unappraised item, then enter teleport portal-space:
		// visible tiers remain shown for retained HUD windows while pending polling cancels.
		entities.set(52, makeEquipment(52, { cantrip: { kind: "unappraised" } }));
		emit("entities");
		expect(requestedFacts).toHaveLength(2);

		setLifecycle({
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 2,
		});
		emit("lifecycle");
		expect(owner.tierFor(50)).toBe("legendary");
		expect(cancels.get(52)).toHaveBeenCalledTimes(1);

		// Returning to in-world re-polls unappraised items cleanly.
		setLifecycle({ kind: "in-world" });
		emit("lifecycle");
		expect(requestedFacts.map((entry) => entry.guid)).toEqual([51, 52, 51, 52]);

		// Resync cancels pending work and re-polls current unappraised gear.
		emit("resyncing");
		expect(requestedFacts.map((entry) => entry.guid)).toEqual([
			51, 52, 51, 52, 51, 52,
		]);

		owner.destroy();
	});
});
