import { afterEach, describe, expect, it, vi } from "vitest";
import { UiIconRepository } from "../app/ui-icon-repository";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import {
	emptyHousing,
	type HousingCrystal,
	type HousingPreviewResult,
	type HousingSnapshot,
} from "./client-housing-contract";
import {
	ClientHouseCrystalState,
	type HouseCrystalSession,
} from "./client-house-crystal-state";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";
import { housingPaymentIcons } from "./client-housing-payment-icons";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function profile(crystal = 100): HousingCrystal {
	return {
		ownership: "available",
		crystal: {
			crystal,
			dwellingId: 10,
			owner: 0,
			ownerName: "",
			flags: 1,
			active: true,
			requiresMonarch: false,
			houseType: 1,
			maintenanceFree: false,
			maintenancePaid: false,
			minLevel: -1,
			maxLevel: -1,
			minAllegianceRank: -1,
			maxAllegianceRank: -1,
			buy: [
				{
					wcid: 273,
					required: 13,
					paid: 0,
					remaining: 13,
					name: "Pyreal",
					pluralName: "Pyreals",
				},
			],
			rent: [
				{
					wcid: 273,
					required: 10,
					paid: 0,
					remaining: 10,
					name: "Pyreal",
					pluralName: "Pyreals",
				},
			],
		},
	};
}

function fixture(distance: number | null = 0) {
	let reach = distance;
	const entities = new ClientEntityMirror();
	const items = [10, 11].map((guid, index) =>
		entityFacts(guid, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index },
			},
		}),
	);
	const replace = (ids: readonly number[]) =>
		entities.commit(
			entities.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
					entities: [
						entityFacts(1),
						entityFacts(100),
						...items.filter((item) => ids.includes(item.guid)),
					],
				},
				1,
			),
		);
	replace([10, 11]);
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	let housing: HousingSnapshot = emptyHousing();
	let playerGuid: number | null = 1;
	const emit = (event: ClientLifecycleSessionEvent) => {
		if (event.type === "housing-updated") housing = event.housing;
		for (const listener of listeners) listener(event);
	};
	const preview = vi.fn<HouseCrystalSession["previewHousingPayment"]>(
		async () => {},
	);
	const submit = vi.fn<HouseCrystalSession["submitHousingPayment"]>(
		async () => {},
	);
	const failure = vi.fn();
	const open = vi.fn();
	const icons = new UiIconRepository({
		prepare: async (requests) =>
			requests.map(({ key }) => ({
				kind: "ready",
				key,
				image: new Uint8Array([1]),
			})),
		createImage: async () => "blob:fixture",
		revokeImage: vi.fn(),
		report: vi.fn(),
	});
	const model = new ClientHouseCrystalState(
		{
			entities,
			previewHousingPayment: preview,
			submitHousingPayment: submit,
			housingSnapshot: () => housing,
			state: () => ({ playerGuid }),
			tradeSnapshot: () => ({ trade: null, pending_items: [] }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		icons,
		failure,
		() => reach,
		open,
	);
	const pending = () => {
		const call = preview.mock.lastCall;
		if (call === undefined) throw new Error("No preview");
		return call[0];
	};
	const answer = (selected?: number[], complete = false) => {
		const request = pending();
		const ids =
			selected ??
			(request.operation.kind === "add"
				? [...request.draft.items, request.operation.item]
				: request.draft.items);
		emit({
			type: "housing-payment-preview",
			result: {
				sequence: request.sequence,
				crystal: request.draft.crystal,
				outcome: {
					kind: "ready",
					items: ids,
					quote: {
						lines: [
							{
								wcid: 273,
								sources: ids,
								consumption: ids.map((item) => ({
									item,
									quantity: 1,
									value: 3,
								})),
								credited: ids.length * 3,
								effectivePaid: ids.length * 3,
								shortfall: 13 - ids.length * 3,
								excess: 0,
							},
						],
						complete,
						contributes: ids.length > 0,
					},
					unavailable: [],
				},
			},
		});
	};
	cleanups.push(() => {
		model.destroy();
		icons.dispose();
	});
	return {
		model,
		entities,
		icons,
		emit,
		pending,
		answer,
		preview,
		submit,
		setPlayer: (value: number | null) => {
			playerGuid = value;
		},
		failure,
		open,
		replace,
		setDistance: (value: number | null) => {
			reach = value;
		},
	};
}

describe("crystal draft ownership", () => {
	it("leases requirement artwork with no inventory in both payment modes and releases it on close", () => {
		const f = fixture();
		f.replace([]);
		const retain = vi.spyOn(f.icons, "retain");
		for (const ownership of ["available", "character"] as const) {
			f.emit({
				type: "housing-crystal-received",
				crystal: { ...profile(), ownership },
			});
			const view = f.model.read();
			if (view === null || view.rows[0].iconKey === null)
				throw new Error("Missing requirement artwork");
			const key = view.rows[0].iconKey;
			expect(view.rows[0].sources).toEqual([]);
			expect(view.iconKeys).toContain(key);
			expect(retain).toHaveBeenLastCalledWith(
				expect.anything(),
				housingPaymentIcons.get(273),
			);
			f.model.close();
			expect(() => f.icons.read(key)).toThrow("Unknown retained icon");
		}
	});

	it("prefers matching carried artwork and returns to reference artwork when the item leaves", () => {
		const f = fixture();
		const facts = entityFacts(10, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index: 0 },
			},
		});
		if (facts.description.kind !== "known")
			throw new Error("Expected item description");
		const icon = { ...facts.description.icon, base: 0x06000001 };
		f.entities.commit(
			f.entities.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
					entities: [
						entityFacts(1),
						entityFacts(100),
						{
							...facts,
							description: { ...facts.description, wcid: 273, icon },
						},
					],
				},
				1,
			),
		);
		const retain = vi.spyOn(f.icons, "retain");
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		expect(retain).toHaveBeenLastCalledWith(expect.anything(), {
			kind: "item",
			...icon,
			itemType: facts.description.itemType,
		});
		const carriedKey = f.model.read()?.rows[0].iconKey;
		f.replace([]);
		const referenceKey = f.model.read()?.rows[0].iconKey;
		expect(referenceKey).not.toBe(carriedKey);
		expect(retain).toHaveBeenLastCalledWith(
			expect.anything(),
			housingPaymentIcons.get(273),
		);
	});

	it("retires old-character receipt ownership when another character starts entry", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer([10], true);
		f.model.pay();
		const request = f.submit.mock.calls[0][0];
		f.emit({
			type: "lifecycle",
			lifecycle: { kind: "entering-world", characterGuid: 2 },
		});
		f.emit({
			type: "housing-payment-finished",
			result: {
				sequence: request.sequence,
				crystal: 100,
				outcome: { kind: "unresolved", reason: "Old-character payment" },
				notify: true,
			},
		});
		expect(f.failure).not.toHaveBeenCalled();
		expect(f.model.read()).toBeNull();
	});
	it("submits current purchase consumption directly and dispatches only once", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer([10]);
		f.model.pay();
		expect(f.submit).not.toHaveBeenCalled();
		f.model.autoFill(273);
		f.answer([10, 11], true);
		const quote = f.model.read()?.quote;
		f.model.pay();
		f.model.pay();
		expect(f.submit).toHaveBeenCalledTimes(1);
		expect(f.submit.mock.calls[0][0]).toMatchObject({
			player: 1,
			draft: { crystal: 100, purpose: "purchase", items: [10, 11] },
			quote,
		});
		expect(f.model.read()?.paymentPending).toBe(true);
		expect(f.model.read()?.editable).toBe(false);
	});

	it("refuses payment after inventory invalidation or when no character is active", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer([10], true);
		f.replace([11]);
		f.emit({ type: "entities" });
		f.model.pay();
		expect(f.submit).not.toHaveBeenCalled();
		f.answer([11], true);
		f.setPlayer(null);
		f.model.pay();
		expect(f.submit).not.toHaveBeenCalled();
	});

	it("keeps pending ownership after dismissal and toasts one correlated uncertainty", () => {
		const f = fixture();
		const owned = profile();
		owned.ownership = "other";
		owned.crystal.owner = 2;
		f.emit({ type: "housing-crystal-received", crystal: owned });
		f.answer([10]);
		f.model.pay();
		expect(f.submit.mock.calls[0][0].draft.purpose).toBe("maintenance");
		const request = f.submit.mock.calls[0][0];
		f.model.close();
		const result = {
			sequence: request.sequence,
			crystal: request.draft.crystal,
			outcome: {
				kind: "unresolved",
				reason: "Payment could not be confirmed",
			} as const,
			notify: true,
		};
		f.emit({
			type: "housing-payment-finished",
			result: { ...result, sequence: request.sequence + 1 },
		});
		expect(f.failure).not.toHaveBeenCalled();
		f.emit({ type: "housing-payment-finished", result });
		f.emit({ type: "housing-payment-finished", result });
		expect(f.failure).toHaveBeenCalledExactlyOnceWith(result.outcome.reason);
		expect(f.model.read()).toBeNull();
	});

	it("restores the submitted lock from retained facts and leaves structured-error toasts to their wire owner", () => {
		const f = fixture();
		const pendingPayment = {
			sequence: 99,
			crystal: 100,
			purpose: "purchase",
		} as const;
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), pendingPayment },
		});
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		expect(f.model.read()?.paymentPending).toBe(true);
		expect(f.model.read()?.editable).toBe(false);
		f.emit({
			type: "housing-payment-finished",
			result: {
				sequence: 99,
				crystal: 100,
				outcome: { kind: "rejected", reason: "Server rejected payment" },
				notify: false,
			},
		});
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), crystal: profile() },
		});
		expect(f.failure).not.toHaveBeenCalled();
		expect(f.model.read()?.paymentPending).toBe(false);
	});
	it("opens from receipts while retained snapshots never replay window intent", () => {
		const f = fixture();
		expect(f.model.read()).toBeNull();
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), crystal: profile() },
		});
		expect(f.model.read()).toBeNull();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		expect(f.model.read()?.purpose).toBe("purchase");
		expect(f.open).toHaveBeenCalledOnce();
		f.model.close();
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), crystal: profile() },
		});
		expect(f.model.read()).toBeNull();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		expect(f.model.read()?.focusRevision).toBe(2);
	});

	it("commits additions only from a current quote and auto-fill preserves existing selection", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.add(100, 273, 10);
		expect(f.model.read()?.items).toEqual([]);
		f.answer();
		expect(f.model.read()?.items.map((item) => item.item)).toEqual([10]);
		f.model.autoFill(273);
		expect(f.pending().operation).toEqual({ kind: "fill", wcid: 273 });
		expect(f.pending().draft.items).toEqual([10]);
		f.answer([10, 11]);
		expect(f.model.read()?.items.map((item) => item.item)).toEqual([10, 11]);
		const drag = f.model.captureRow(273);
		if (drag === null) throw new Error("Expected selected row");
		f.model.clearRow(drag);
		expect(f.pending().draft.items).toEqual([]);
		f.answer();
		expect(f.model.read()?.items).toEqual([]);
	});

	it("toasts incomplete auto-fill once while retaining its usable draft", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		expect(f.failure).not.toHaveBeenCalled();
		f.model.autoFill(273);
		f.answer([10]);
		expect(f.failure).toHaveBeenCalledExactlyOnceWith(
			"Could not fill Pyreal: 10 still needed.",
		);
		expect(f.model.read()?.items.map((item) => item.item)).toEqual([10]);
		expect(f.model.read()?.problem).toBeNull();
		f.answer([10]);
		expect(f.failure).toHaveBeenCalledTimes(1);
	});

	it("ignores obsolete receipts after profile replacement, dismissal, and candidate invalidation", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.add(100, 273, 10);
		const stale = f.pending();
		f.emit({ type: "housing-crystal-received", crystal: profile(101) });
		const result: HousingPreviewResult = {
			sequence: stale.sequence,
			crystal: 100,
			outcome: { kind: "rejected", reason: "Old refusal" },
		};
		f.emit({ type: "housing-payment-preview", result });
		expect(f.model.read()?.profile.crystal.crystal).toBe(101);
		expect(f.failure).not.toHaveBeenCalled();
		f.model.close();
		f.answer([10]);
		expect(f.model.read()).toBeNull();
	});

	it("requotes current inventory and removes sources whose accepted ownership disappears", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.add(100, 273, 10);
		f.answer();
		f.replace([11]);
		f.emit({ type: "entities" });
		expect(f.model.read()?.items).toEqual([]);
		expect(f.pending().draft.items).toEqual([]);
		f.answer();
		expect(f.model.read()?.quote?.contributes).toBe(false);
	});

	it("invalidates in-flight candidates as soon as inventory facts change", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.add(100, 273, 10);
		f.replace([10, 11]);
		f.emit({ type: "entities" });
		f.answer([10]);
		expect(f.model.read()?.items).toEqual([]);
		expect(f.pending().draft.items).toEqual([]);
	});

	it("waits for pose hydration, then dismisses on range exit or disappearance", () => {
		const f = fixture(null);
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		expect(f.model.read()?.editable).toBe(false);
		f.setDistance(CLIENT_TUNING.housing.maximumDistanceMeters);
		expect(f.model.read()?.editable).toBe(true);
		f.setDistance(CLIENT_TUNING.housing.maximumDistanceMeters + 1);
		expect(f.model.read()).toBeNull();
		f.setDistance(0);
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.read();
		f.setDistance(null);
		expect(f.model.read()).toBeNull();
	});

	it("retires interaction on recovery, travel, and vendor opening", () => {
		const f = fixture();
		for (const event of [
			{ type: "resyncing" },
			{
				type: "lifecycle",
				lifecycle: {
					kind: "portal-space",
					worldGeneration: 2,
					cause: "teleport",
				},
			},
			{
				type: "vendor-snapshot",
				vendor: {
					vendor: 999,
					currency: { wcid: 273, name: "Pyreals" },
					offers: [],
				},
			},
		] satisfies ClientLifecycleSessionEvent[]) {
			f.emit({ type: "housing-crystal-received", crystal: profile() });
			f.answer();
			f.emit(event);
			expect(f.model.read()).toBeNull();
		}
	});

	it("retires an interaction when authoritative crystal knowledge is cleared", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.emit({ type: "housing-updated", housing: emptyHousing() });
		expect(f.model.read()).toBeNull();
		expect(f.model.acceptsDrop(100, 10)).toBe(false);
	});

	it("displays disabled, free, paid, and account-owner facts without creating an actionable draft", () => {
		const f = fixture();
		for (const mode of ["disabled", "free", "paid"] as const) {
			const owned = profile();
			owned.ownership = "account";
			owned.crystal.owner = 2;
			owned.crystal.ownerName = "Alt";
			owned.crystal.active = mode !== "disabled";
			owned.crystal.maintenanceFree = mode === "free";
			owned.crystal.maintenancePaid = mode === "paid";
			f.emit({ type: "housing-crystal-received", crystal: owned });
			expect(f.model.read()?.profile).toEqual(owned);
			expect(f.model.read()?.editable).toBe(false);
		}
		expect(f.preview).not.toHaveBeenCalled();
	});
	it("preserves Details across progress updates and defaults action on ownership replacement", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer();
		f.model.selectTab("details");
		const updated = profile();
		updated.crystal.buy[0].paid = 2;
		updated.crystal.buy[0].remaining = 11;
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), crystal: updated },
		});
		expect(f.model.read()?.tab).toBe("details");
		const owned = profile();
		owned.ownership = "account";
		owned.crystal.owner = 2;
		f.emit({
			type: "housing-updated",
			housing: { ...emptyHousing(), crystal: owned },
		});
		expect(f.model.read()?.tab).toBe("action");
		expect(f.model.read()?.purpose).toBe("maintenance");
		f.model.selectTab("details");
		f.emit({ type: "housing-crystal-received", crystal: owned });
		expect(f.model.read()?.tab).toBe("action");
	});

	it("rejects stale row clearing and keeps accepted sources after a mismatched addition", () => {
		const f = fixture();
		f.emit({ type: "housing-crystal-received", crystal: profile() });
		f.answer([10]);
		const stale = f.model.captureRow(273);
		if (stale === null) throw new Error("Expected row selection");
		f.model.autoFill(273);
		f.answer([10]);
		const before = f.pending();
		f.model.clearRow(stale);
		expect(f.pending()).toBe(before);
		expect(
			f.model.read()?.rows[0].sources.map((source) => source.item),
		).toEqual([10]);
		f.model.add(100, 273, 11);
		const rejected = f.pending();
		f.emit({
			type: "housing-payment-preview",
			result: {
				sequence: rejected.sequence,
				crystal: 100,
				outcome: {
					kind: "rejected",
					reason: "That item does not match this payment requirement",
				},
			},
		});
		expect(
			f.model.read()?.rows[0].sources.map((source) => source.item),
		).toEqual([10]);
		expect(f.failure).toHaveBeenCalledTimes(2);
		expect(f.failure).toHaveBeenLastCalledWith(
			"That item does not match this payment requirement",
		);
		const current = f.model.captureRow(273);
		if (current === null) throw new Error("Expected current row selection");
		f.model.clearRow(current);
		expect(f.pending().operation).toEqual({ kind: "quote" });
		expect(f.pending().draft.items).toEqual([]);
		expect(f.submit).not.toHaveBeenCalled();
	});
});
