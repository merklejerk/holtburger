import { emptyHousing } from "./client-housing-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UiIconRepository } from "../app/ui-icon-repository";
import { ClientLifecycleSession } from "./client-lifecycle-session";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientTradeState } from "./client-trade-state";
import type { ClientCurrentState } from "./client-host-contract";
import type { TradeState } from "./client-trade-contract";

const PLAYER = 1;
const PARTNER = 2;
const ITEM = 3;
const PARTNER_ITEM = 4;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function fixture() {
	const listeners = new Map<string, (value: unknown) => void>();
	const invoke = vi.fn().mockResolvedValue(undefined);
	const lifecycle = new ClientLifecycleSession({
		invoke,
		listen: async (name, listener) => {
			listeners.set(name, listener);
			return () => listeners.delete(name);
		},
	});
	await lifecycle.start();
	const emit = (name: string, payload: unknown) => {
		const listener = listeners.get(name);
		if (listener === undefined) throw new Error(`Missing listener: ${name}`);
		listener(payload);
	};
	const trade: TradeState = {
		revision: 1,
		partner_guid: PARTNER,
		initiator_guid: PLAYER,
		trade_stamp: 0,
		self_side: { guid: PLAYER, accepted: false, items: [] },
		partner_side: { guid: PARTNER, accepted: false, items: [] },
	};
	const baseline: ClientCurrentState = {
		barber: { interaction: null, result: null, particles: null },
		lifecycle: { kind: "in-world" },
		characterManagement: { kind: "idle" },
		playerVisualCapture: null,
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		localPlayerGuid: PLAYER,
		serverTime: 1,
		worldGeneration: 1,
		connection: null,
		worldName: "Fixture",
		accountName: "Fixture account",
		playerName: "Player",
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		gameplayPreferences: null,
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
		socialMotionReady: true,
		combat: {
			desired: null,
			state: "idle",
			processedIntentSequence: 0,
			refill: null,
		},
		spellCastTarget: null,
		vitals: [],
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		characterMotion: null,
		activeConfirmation: null,
		dynamic: { hostTime: { seconds: 1 }, entities: [] },
		entities: {
			projectileSupply: { kind: "not-applicable" },
			salvage: {
				skills: {
					salvagingSkill: 0,
					tinkeringSkill: 0,
					augmentationBonusSalvage: 0,
				},
			},
			worldContainer: { kind: "closed" },
			entities: [
				entityFacts(PLAYER, {
					storage: {
						kind: "container",
						roster: "announced",
						itemCapacity: 24,
						packCapacity: 7,
					},
				}),
				entityFacts(PARTNER, { canTrade: true }),
				entityFacts(ITEM, {
					ownedByPlayer: true,
					canOfferTrade: true,
					salvage: {
						kind: "ineligible",
						reason: "Fixture item cannot be salvaged.",
					},
					location: {
						kind: "contained",
						parentGuid: PLAYER,
						slot: { kind: "item", index: 0 },
					},
				}),
				entityFacts(PARTNER_ITEM),
			],
		},
	};
	emit("client-current-state", baseline);
	const icons = new UiIconRepository({
		prepare: async () => [],
		createImage: async () => "fixture",
		revokeImage: vi.fn(),
		report: vi.fn(),
	});
	const failure = vi.fn();
	const model = new ClientTradeState(lifecycle, icons, failure);
	const snapshot = (
		value: TradeState | null,
		pending_items: readonly number[] = [],
	) => emit("client-trade-snapshot", { trade: value, pending_items });
	cleanups.push(() => {
		model.destroy();
		lifecycle.stop();
		icons.dispose();
	});
	return { model, lifecycle, baseline, trade, snapshot, emit, invoke, failure };
}

describe("P2P trade HUD authority", () => {
	it("offers Main Pack's direct items without offering the character", async () => {
		const f = await fixture();
		f.snapshot(f.trade);
		expect(f.model.acceptsDrop(PARTNER, f.trade.revision, PLAYER)).toBe(true);
		f.model.add(PARTNER, f.trade.revision, PLAYER);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: {
				kind: "add",
				partner: PARTNER,
				revision: f.trade.revision,
				items: [ITEM],
			},
		});
	});

	it("offers eligible pack contents once and permits reset/close while they await acknowledgment", async () => {
		const f = await fixture();
		const pack = entityFacts(20, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: PLAYER,
				slot: { kind: "pack", index: 0, entryKind: "container" },
			},
			storage: {
				kind: "container",
				roster: "announced",
				itemCapacity: 24,
				packCapacity: 0,
			},
		});
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
			removed: [],
			upserts: [
				pack,
				...[21, 22, 23].map((guid) =>
					entityFacts(guid, {
						ownedByPlayer: true,
						canOfferTrade: guid !== 23,
						location: {
							kind: "contained",
							parentGuid: pack.guid,
							slot: { kind: "item", index: guid },
						},
					}),
				),
			],
		});
		f.snapshot(f.trade);
		expect(f.model.inventoryItemUnavailable(pack.guid)).toBe(false);
		f.model.add(PARTNER, f.trade.revision, pack.guid);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: {
				kind: "add",
				partner: PARTNER,
				revision: f.trade.revision,
				items: [21, 22],
			},
		});
		f.snapshot(f.trade, [21, 22]);
		expect(f.model.acceptsDrop(PARTNER, f.trade.revision, pack.guid)).toBe(
			false,
		);
		expect(f.model.read()?.canAccept).toBe(false);
		f.model.reset();
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: { kind: "reset", partner: PARTNER },
		});
		f.model.close();
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: { kind: "close", partner: PARTNER },
		});
		f.snapshot({ ...f.trade, revision: f.trade.revision + 1 });
		const count = f.invoke.mock.calls.length;
		f.model.add(PARTNER, f.trade.revision, pack.guid);
		expect(f.invoke).toHaveBeenCalledTimes(count);
	});

	it("offers an empty pack itself", async () => {
		const f = await fixture();
		f.emit("client-entity-facts-changed", {
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
			removed: [],
			upserts: [
				entityFacts(20, {
					ownedByPlayer: true,
					canOfferTrade: true,
					location: {
						kind: "contained",
						parentGuid: PLAYER,
						slot: { kind: "pack", index: 0, entryKind: "container" },
					},
					storage: {
						kind: "container",
						roster: "announced",
						itemCapacity: 24,
						packCapacity: 0,
					},
				}),
			],
		});
		f.snapshot(f.trade);
		f.model.add(PARTNER, f.trade.revision, 20);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: {
				kind: "add",
				partner: PARTNER,
				revision: f.trade.revision,
				items: [20],
			},
		});
	});

	it("opens only after registration, including incoming registrations", async () => {
		const f = await fixture();
		f.model.open(PARTNER);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: { kind: "open", partner: PARTNER },
		});
		expect(f.model.read()).toBeNull();
		f.snapshot({ ...f.trade, initiator_guid: PARTNER });
		expect(f.model.read()?.partnerName).toBe(`Item ${PARTNER}`);
	});
	it("keeps additions pending until acknowledgment and retires rejected additions", async () => {
		const f = await fixture();
		f.snapshot(f.trade);
		f.model.add(PARTNER, f.trade.revision, ITEM);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: {
				kind: "add",
				partner: PARTNER,
				revision: f.trade.revision,
				items: [ITEM],
			},
		});
		f.snapshot(f.trade, [ITEM]);
		expect(f.model.read()?.own).toEqual([]);
		expect(f.model.read()?.pendingItems).toBe(1);
		expect(f.model.read()?.canAccept).toBe(false);
		f.snapshot(f.trade);
		expect(f.model.read()?.pendingItems).toBe(0);
		expect(f.model.acceptsDrop(PARTNER, f.trade.revision, ITEM)).toBe(true);
		f.model.add(PARTNER, f.trade.revision, ITEM);
		f.snapshot({
			...f.trade,
			revision: 2,
			self_side: { ...f.trade.self_side, items: [ITEM] },
		});
		expect(f.model.read()?.own.map((cell) => cell.guid)).toEqual([ITEM]);
		expect(f.model.read()?.pendingItems).toBe(0);
	});
	it("accepts the displayed revision and keeps reset and close authoritative", async () => {
		const f = await fixture();
		f.snapshot(f.trade);
		const displayed = f.model.read();
		if (displayed === null) throw new Error("Trade window absent");
		f.snapshot({
			...f.trade,
			revision: 2,
			partner_side: { ...f.trade.partner_side, items: [PARTNER_ITEM] },
		});
		f.model.accept(displayed.trade.revision);
		expect(f.invoke).toHaveBeenLastCalledWith("submit_client_trade", {
			request: {
				kind: "accept",
				partner: PARTNER,
				revision: displayed.trade.revision,
			},
		});
		f.model.reset();
		expect(f.model.read()?.partner.map((cell) => cell.guid)).toEqual([
			PARTNER_ITEM,
		]);
		f.snapshot({ ...f.trade, revision: 3 });
		expect(f.model.read()?.partner).toEqual([]);
		f.model.close();
		expect(f.model.read()).not.toBeNull();
		f.snapshot(null);
		expect(f.model.read()).toBeNull();
	});
	it("blocks recovery gestures and restores offers from the atomic baseline", async () => {
		const f = await fixture();
		f.snapshot(f.trade);
		f.emit("client-state-resyncing", null);
		expect(f.model.acceptsDrop(PARTNER, f.trade.revision, ITEM)).toBe(false);
		expect(f.model.read()?.canAccept).toBe(false);
		f.emit("client-current-state", {
			...f.baseline,
			trade: {
				trade: {
					...f.trade,
					partner_side: { ...f.trade.partner_side, items: [PARTNER_ITEM] },
				},
				pending_items: [],
			},
		});
		expect(f.model.read()?.partner.map((cell) => cell.guid)).toEqual([
			PARTNER_ITEM,
		]);
		expect(f.model.read()?.canAccept).toBe(true);
	});
	it("blocks acceptance while an offered identity lacks a description", async () => {
		const f = await fixture();
		f.snapshot({
			...f.trade,
			partner_side: { ...f.trade.partner_side, items: [99] },
		});
		expect(f.model.read()?.partner[0]?.described).toBe(false);
		expect(f.model.read()?.canAccept).toBe(false);
	});
});
