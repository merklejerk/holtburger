import { afterEach, describe, expect, it, vi } from "vitest";
import { UiIconRepository } from "../app/ui-icon-repository";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type {
	VendorOffer,
	VendorQuote,
	VendorRequest,
	VendorSnapshot,
} from "./client-vendor-contract";
import { ClientVendorState, type VendorSession } from "./client-vendor-state";
import { CLIENT_TUNING } from "./client-tuning";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});
const vendorId = 100;
const stackOffer: VendorOffer = {
	guid: 200,
	wcid: 200,
	name: "Component",
	item_type: 0x1000,
	stack_count: 10,
	stackable: true,
	supply: null,
	icon: { base: 1, overlay: null, underlay: null, uiEffects: 0 },
	price: { kind: "quoted", amount: 20, quantity: 10 },
};
const singleOffer: VendorOffer = {
	...stackOffer,
	guid: 201,
	wcid: 201,
	name: "Sword",
	item_type: 1,
	stack_count: 1,
	stackable: false,
};
const catalog: VendorSnapshot = {
	vendor: vendorId,
	currency: { wcid: 273, name: "Pyreals" },
	offers: [singleOffer, stackOffer],
};
const blank: VendorQuote = {
	buys: [],
	sells: [],
	currencies: [{ wcid: 273, name: "Pyreals", current: 3000, projected: 3000 }],
	affordable: true,
};

function fixture(initialDistance: number | null = 0) {
	let vendorDistance = initialDistance;
	const entities = new ClientEntityMirror();
	entities.commit(
		entities.prepareSnapshot(
			{
				projectileSupply: { kind: "not-applicable" },
				worldContainer: { kind: "closed" },
				entities: [
					entityFacts(1),
					entityFacts(vendorId),
					...[10, 11, 12].map((id, index) =>
						entityFacts(id, {
							ownedByPlayer: true,
							location: {
								kind: "contained",
								parentGuid: 1,
								slot: { kind: "item", index },
							},
						}),
					),
				],
			},
			1,
		),
	);
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const emit = (event: ClientLifecycleSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const previewVendor = vi.fn<VendorSession["previewVendor"]>(async () => {});
	const submitVendor = vi.fn<VendorSession["submitVendor"]>(async () => {});
	const failure = vi.fn();
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
	const model = new ClientVendorState(
		{
			entities,
			vendorSnapshot: () => catalog,
			previewVendor,
			submitVendor,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		icons,
		failure,
		() => vendorDistance,
	);
	const pending = (): VendorRequest => {
		const call = previewVendor.mock.lastCall;
		if (call === undefined) throw new Error("No pending quote");
		return call[0];
	};
	const answer = (quote: VendorQuote) =>
		emit({
			type: "vendor-preview",
			result: {
				sequence: pending().sequence,
				vendor: pending().draft.vendor,
				outcome: { kind: "ready", quote },
			},
		});
	model.read(); // Capture the already-current entity level before answering the opening quote.
	answer(blank);
	cleanups.push(() => {
		model.destroy();
		icons.dispose();
	});
	return {
		model,
		emit,
		pending,
		answer,
		previewVendor,
		submitVendor,
		failure,
		setVendorDistance: (distance: number | null) => {
			vendorDistance = distance;
		},
	};
}

function buy(model: ClientVendorState, item: number, amount?: number): void {
	model.queueBuy(item);
	const request = model.read()?.quantityRequest;
	if (request !== null && request !== undefined)
		model.confirmBuyQuantity(item, amount ?? request.initialAmount);
}

describe("vendor draft presentation", () => {
	it("closes at the reach limit and checks again when Trade is pressed", () => {
		const f = fixture();
		f.model.queueSell(10);
		f.answer({
			...blank,
			sells: [{ item: 10, amount: 1, total: 1, merge_key: null }],
		});
		f.setVendorDistance(CLIENT_TUNING.vendor.maximumDistanceMeters);
		expect(f.model.read()?.canTrade).toBe(true);
		f.setVendorDistance(CLIENT_TUNING.vendor.maximumDistanceMeters + 0.01);
		f.model.trade();
		expect(f.submitVendor).not.toHaveBeenCalled();
		expect(f.model.read()).toBeNull();
	});

	it("waits for a measured pose and closes when a previously seen vendor vanishes", () => {
		const f = fixture(null);
		expect(f.model.acceptsDrop(vendorId)).toBe(false);
		expect(f.model.read()).not.toBeNull();
		f.setVendorDistance(0);
		expect(f.model.acceptsDrop(vendorId)).toBe(true);
		f.setVendorDistance(null);
		expect(f.model.read()).toBeNull();
	});

	it("closes the open panel when its sampled distance exceeds the limit", () => {
		const f = fixture(CLIENT_TUNING.vendor.maximumDistanceMeters + 1);
		expect(f.model.read()).toBeNull();
	});

	it("keeps sale admission idempotent and blocks trading an unaffordable quote", () => {
		const f = fixture();
		f.model.queueSell(10);
		f.answer({
			...blank,
			sells: [{ item: 10, amount: 1, total: 1, merge_key: null }],
		});
		const previews = f.previewVendor.mock.calls.length;
		f.model.queueSell(10);
		expect(f.previewVendor).toHaveBeenCalledTimes(previews);
		buy(f.model, stackOffer.guid);
		f.answer({
			...blank,
			buys: [
				{ item: stackOffer.guid, amount: 10, total: 5000, merge_key: 500 },
			],
			sells: [{ item: 10, amount: 1, total: 1, merge_key: null }],
			affordable: false,
			currencies: [
				{ wcid: 273, name: "Pyreals", current: 3000, projected: -1999 },
			],
		});
		expect(f.model.read()?.canTrade).toBe(false);
		f.model.trade();
		expect(f.submitVendor).not.toHaveBeenCalled();
	});

	it("prompts before adding stackables, and restricts finite offers to whole objects", () => {
		const f = fixture();
		f.emit({
			type: "vendor-snapshot",
			vendor: { ...catalog, offers: [{ ...stackOffer, supply: 10 }] },
		});
		f.answer(blank);
		const previous = f.previewVendor.mock.calls.length;
		f.model.queueBuy(stackOffer.guid);
		expect(f.model.read()?.quantityRequest).toMatchObject({
			minAmount: 10,
			maxAmount: 10,
			initialAmount: 10,
		});
		expect(f.previewVendor).toHaveBeenCalledTimes(previous);
		f.model.confirmBuyQuantity(stackOffer.guid, 9);
		expect(f.model.read()?.quantityRequest).not.toBeNull();
		f.model.confirmBuyQuantity(stackOffer.guid, 10);
		expect(f.pending().draft.buys).toEqual([
			{ item: stackOffer.guid, amount: 10 },
		]);
		f.answer({
			...blank,
			buys: [{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 }],
		});
		f.model.queueBuy(stackOffer.guid);
		expect(f.model.read()?.quantityRequest).toBeNull();
		f.emit({ type: "vendor-snapshot", vendor: catalog });
		f.answer({
			...blank,
			buys: [{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 }],
		});
		f.model.queueBuy(stackOffer.guid);
		expect(f.model.read()?.quantityRequest).toMatchObject({
			minAmount: 1,
			maxAmount: 0x7fff_ffff - 10,
			initialAmount: 10,
		});
		f.model.cancelBuyQuantity();
		expect(f.model.read()?.quantityRequest).toBeNull();
	});

	it("uses retail category order and admits whole offer stacks only after a matching quote", () => {
		const f = fixture();
		expect(f.model.read()?.sections.map((section) => section.name)).toEqual([
			"Spell Components",
			"Weapons",
		]);
		buy(f.model, stackOffer.guid);
		expect(f.pending().draft.buys).toEqual([
			{ item: stackOffer.guid, amount: stackOffer.stack_count },
		]);
		expect(f.model.read()?.queue).toEqual([]);
		expect(f.model.read()?.canTrade).toBe(false);
		f.answer({
			...blank,
			buys: [{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 }],
		});
		expect(f.model.read()?.queue).toMatchObject([
			{ amount: 10, total: 20, side: "buy", sources: [stackOffer.guid] },
		]);
		buy(f.model, stackOffer.guid);
		expect(f.pending().draft.buys).toEqual([
			{ item: stackOffer.guid, amount: 20 },
		]);
	});

	it("merges only compatible stackables and preserves each sale source behind the cell", () => {
		const f = fixture();
		f.model.queueSell(10);
		const first = { item: 10, amount: 80, total: 40, merge_key: 900 };
		f.answer({ ...blank, sells: [first] });
		f.model.queueSell(11);
		const second = { item: 11, amount: 80, total: 40, merge_key: 900 };
		f.answer({ ...blank, sells: [first, second] });
		f.model.queueSell(12);
		const third = { item: 12, amount: 1, total: 3, merge_key: null };
		f.answer({ ...blank, sells: [first, second, third] });
		const queue = f.model.read()?.queue;
		expect(queue).toMatchObject([
			{ amount: 160, total: 80, sources: [11, 10] },
			{ amount: 1, sources: [12] },
		]);
		const merged = queue?.[0];
		if (merged === undefined) throw new Error("Expected merged cell");
		f.model.remove(merged);
		expect(f.pending().draft.sells).toEqual([12]);
	});

	it("keeps nonstackable purchases separate and removes one copy at a time", () => {
		const f = fixture();
		buy(f.model, singleOffer.guid);
		f.answer({
			...blank,
			buys: [
				{ item: singleOffer.guid, amount: 1, total: 100, merge_key: null },
			],
		});
		buy(f.model, singleOffer.guid);
		f.answer({
			...blank,
			buys: [
				{ item: singleOffer.guid, amount: 2, total: 200, merge_key: null },
			],
		});
		const queue = f.model.read()?.queue;
		expect(queue).toMatchObject([
			{ amount: 1, total: 100 },
			{ amount: 1, total: 100 },
		]);
		const cell = queue?.[0];
		if (cell === undefined) throw new Error("Expected purchase cell");
		f.model.remove(cell);
		expect(f.pending().draft.buys).toEqual([
			{ item: singleOffer.guid, amount: 1 },
		]);
	});

	it("rejects a sale candidate without changing the admitted draft", () => {
		const f = fixture();
		buy(f.model, stackOffer.guid);
		const quote = {
			...blank,
			buys: [{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 }],
		};
		f.answer(quote);
		f.model.queueSell(10);
		f.emit({
			type: "vendor-preview",
			result: {
				sequence: f.pending().sequence,
				vendor: vendorId,
				outcome: { kind: "rejected", reason: "This item is retained" },
			},
		});
		expect(f.failure).toHaveBeenCalledWith("This item is retained");
		expect(f.model.read()?.queue).toHaveLength(1);
		expect(f.model.read()?.canTrade).toBe(true);
		f.model.trade();
		expect(f.submitVendor.mock.lastCall?.[0].draft.sells).toEqual([]);
	});

	it("preserves a pending addition across stock refresh and ignores superseded replies", () => {
		const f = fixture();
		buy(f.model, stackOffer.guid);
		const old = f.pending();
		f.emit({ type: "vendor-snapshot", vendor: catalog });
		expect(f.pending().draft).toEqual(old.draft);
		expect(f.pending().sequence).not.toEqual(old.sequence);
		f.emit({
			type: "vendor-preview",
			result: {
				sequence: old.sequence,
				vendor: vendorId,
				outcome: { kind: "ready", quote: blank },
			},
		});
		expect(f.model.read()?.pending).toBe(true);
		f.answer({
			...blank,
			buys: [{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 }],
		});
		expect(f.model.read()?.queue).toHaveLength(1);
	});

	it("clears a successful purchase and retains only unsold sources after a partial sale", () => {
		const f = fixture();
		buy(f.model, stackOffer.guid);
		const buys = [
			{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 },
		];
		f.answer({ ...blank, buys });
		f.model.queueSell(10);
		const first = { item: 10, amount: 5, total: 10, merge_key: 900 };
		f.answer({ ...blank, buys, sells: [first] });
		f.model.queueSell(11);
		f.answer({ ...blank, buys, sells: [first, { ...first, item: 11 }] });
		f.model.trade();
		const submitted = f.submitVendor.mock.lastCall?.[0];
		if (submitted === undefined) throw new Error("No submitted trade");
		expect(submitted.draft).toEqual({
			vendor: vendorId,
			buys: [{ item: stackOffer.guid, amount: 10 }],
			sells: [10, 11],
		});
		expect(f.model.read()?.phase).toBe("selling");
		f.model.trade();
		f.emit({ type: "vendor-snapshot", vendor: catalog });
		expect(f.model.read()?.queue).toHaveLength(2);
		expect(f.submitVendor).toHaveBeenCalledTimes(1);
		f.emit({
			type: "vendor-result",
			result: {
				sequence: submitted.sequence,
				vendor: vendorId,
				sold: [10],
				sale_issue: "Sold 1 of 2 queued items",
				outcome: { kind: "completed" },
			},
		});
		expect(f.pending().draft).toEqual({
			...submitted.draft,
			buys: [],
			sells: [11],
		});
		expect(f.failure).toHaveBeenCalledWith(
			"Purchase completed. Sold 1 of 2 queued items",
		);
	});

	it("reports a completed sale followed by failed purchase without restoring sold sources", () => {
		const f = fixture();
		buy(f.model, stackOffer.guid);
		const buys = [
			{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 },
		];
		f.answer({ ...blank, buys });
		f.model.queueSell(10);
		f.answer({
			...blank,
			buys,
			sells: [{ item: 10, amount: 1, total: 7000, merge_key: null }],
		});
		f.model.trade();
		const submitted = f.submitVendor.mock.lastCall?.[0];
		if (submitted === undefined) throw new Error("No submitted trade");
		f.emit({ type: "vendor-phase", phase: "buying" });
		expect(f.model.read()?.phase).toBe("buying");
		f.emit({
			type: "vendor-result",
			result: {
				sequence: submitted.sequence,
				vendor: vendorId,
				sold: [10],
				sale_issue: null,
				outcome: { kind: "failed", phase: "buying", message: "Out of stock" },
			},
		});
		expect(f.pending().draft.sells).toEqual([]);
		expect(f.pending().draft.buys).toEqual(submitted.draft.buys);
		expect(f.failure).toHaveBeenCalledWith(
			"Items sold; purchase failed. Out of stock",
		);
	});

	it("reports both a partial sale and a failed purchase without clearing either remainder", () => {
		const f = fixture();
		buy(f.model, stackOffer.guid);
		const buys = [
			{ item: stackOffer.guid, amount: 10, total: 20, merge_key: 500 },
		];
		f.answer({ ...blank, buys });
		f.model.queueSell(10);
		const first = { item: 10, amount: 5, total: 10, merge_key: 900 };
		f.answer({ ...blank, buys, sells: [first] });
		f.model.queueSell(11);
		f.answer({ ...blank, buys, sells: [first, { ...first, item: 11 }] });
		f.model.trade();
		const submitted = f.submitVendor.mock.lastCall?.[0];
		if (submitted === undefined) throw new Error("No submitted trade");
		f.emit({
			type: "vendor-result",
			result: {
				sequence: submitted.sequence,
				vendor: vendorId,
				sold: [10],
				sale_issue: "Sold 1 of 2 queued items",
				outcome: {
					kind: "failed",
					phase: "buying",
					message: "Not enough currency",
				},
			},
		});
		expect(f.pending().draft).toEqual({ ...submitted.draft, sells: [11] });
		expect(f.failure).toHaveBeenCalledWith(
			"Sold 1 of 2 queued items; purchase failed. Not enough currency",
		);
	});
});
