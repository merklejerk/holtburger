import {
	selectOfferItems,
	type ClientOfferSelection,
} from "./client-offer-selection";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import equal from "fast-deep-equal";
import type {
	ClientEntityFacts,
	ClientEntityLevel,
} from "./client-entity-mirror";
import { PYREAL_ICON_SPEC } from "./client-inventory-art";
import { INVENTORY_CURRENCIES } from "./client-inventory-currencies";
import { CLIENT_TUNING } from "./client-tuning";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	VendorCategory,
	VendorDraft,
	VendorOffer,
	VendorPhase,
	VendorQuote,
	VendorSnapshot,
} from "./client-vendor-contract";

/** Retail open vendor section order; server supplies each offer's category. */
const CATEGORY_LABELS: readonly (readonly [VendorCategory, string])[] = [
	["armor", "Armor"],
	["books-paper", "Books, Paper"],
	["clothing", "Clothing"],
	["containers", "Containers"],
	["food", "Food"],
	["gems", "Gems"],
	["jewelry", "Jewelry"],
	["keys-tools", "Keys, Tools"],
	["miscellaneous", "Miscellaneous"],
	["services", "Services"],
	["spell-components", "Spell Components"],
	["trade-notes", "Trade Notes"],
	["weapons", "Weapons"],
	["mana-stones", "Mana Stones"],
	["magic-items", "Magic Items"],
	["alchemical-items", "Alchemical Items"],
	["cooking-items", "Cooking Items"],
	["fletching-items", "Fletching Items"],
	["other", "Other"],
];

/** Session authority needed by the vendor HUD, independent of DOM lifetime. */
export type VendorSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "vendorSnapshot" | "previewVendor" | "submitVendor" | "entities"
>;

interface CellArtwork {
	readonly name: string;
	readonly iconKey: string;
}

/** One actual offer with persistent artwork, rather than a fabricated entity. */
export interface VendorCatalogCell extends CellArtwork {
	readonly offer: VendorOffer;
}

/** A display group preserves every wire source behind the summed quantity. */
export interface VendorQueueCell extends CellArtwork {
	readonly key: string;
	readonly side: "buy" | "sell";
	/** Shared compatibility controls grouping and single-copy removal. */
	readonly stackable: boolean;
	readonly sources: readonly [number, ...number[]];
	readonly amount: number;
	readonly total: number;
}

/** Pending frontend quantity choice; no draft entry exists until confirmation. */
export interface VendorQuantityRequest {
	readonly item: number;
	readonly name: string;
	readonly minAmount: number;
	readonly maxAmount: number;
	readonly initialAmount: number;
}

/** Bounded display snapshot read by the panel's existing icon sampler. */
export interface VendorView {
	readonly vendor: number;
	readonly name: string;
	/** Vendor payment identity used by catalog and buying-total artwork. */
	readonly currency: NonNullable<VendorSnapshot>["currency"];
	readonly sections: readonly {
		readonly name: string;
		readonly cells: readonly VendorCatalogCell[];
	}[];
	readonly queue: readonly VendorQueueCell[];
	readonly quantityRequest: VendorQuantityRequest | null;
	readonly quote: VendorQuote | null;
	readonly currencyIconKeys: ReadonlyMap<number, string>;
	readonly pending: boolean;
	readonly phase: VendorPhase | null;
	readonly problem: string | null;
	readonly canTrade: boolean;
	readonly iconKeys: readonly string[];
}

interface PendingPreview {
	readonly sequence: number;
	readonly draft: VendorDraft;
	readonly reportRejection: boolean;
	/** Refreshes of the same candidate share one bounded lifetime. */
	readonly deadline: number;
	/** The deadline timer belongs to this preview and retires with it. */
	readonly timer: ReturnType<typeof setTimeout>;
}

let nextSequence = 0;
function sequence(): number {
	if (nextSequence === 0xffff_ffff)
		throw new Error("Vendor request sequence exhausted");
	return ++nextSequence;
}

/** Player balance and coverage are commerce inputs; health and nearby actor facts are not. */
function playerQuoteFacts(level: ClientEntityLevel) {
	const player =
		level.playerGuid === null
			? undefined
			: level.entities.get(level.playerGuid);
	return {
		guid: level.playerGuid,
		storage: player?.storage,
		balance: level.player.pyrealBalance,
	};
}

/** The mirror preserves unchanged record identities; both passes detect ownership gains and losses. */
function quoteInventoryChanged(
	previous: ClientEntityLevel | null,
	next: ClientEntityLevel,
): boolean {
	if (
		previous === null ||
		!equal(playerQuoteFacts(previous), playerQuoteFacts(next))
	)
		return true;
	for (const [guid, item] of previous.entities)
		if (item.ownedByPlayer && next.entities.get(guid) !== item) return true;
	for (const [guid, item] of next.entities)
		if (item.ownedByPlayer && previous.entities.get(guid) !== item) return true;
	return false;
}

/** Session-owned draft; only semantic quotes commit candidate additions. */
export class ClientVendorState {
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	#snapshot: VendorSnapshot = null;
	#draft: VendorDraft | null = null;
	#quote: VendorQuote | null = null;
	#preview: PendingPreview | null = null;
	#execution: { readonly sequence: number; phase: VendorPhase } | null = null;
	#catalog = new Map<number, VendorCatalogCell>();
	#sections: VendorView["sections"] = [];
	#sales = new Map<number, CellArtwork>();
	#purchases = new Map<number, CellArtwork>();
	#currencyIcons = new Map<number, string>();
	#quantityRequest: VendorQuantityRequest | null = null;
	#retained = new Set<string>();
	#visible = false;
	#problem: string | null = null;
	#view: VendorView | null = null;
	/** Last sampled semantic level; unrelated actor updates only invalidate presentation. */
	#entityLevel: ClientEntityLevel | null = null;
	/** Distinguishes initial pose hydration from a vendor that disappeared later. */
	#hadVendorPose = false;
	/** Reach state baked into `#view` so idle display ticks return the cached reference. */
	#canReachVendor = false;
	#disposed = false;
	#recovering = false;

	constructor(
		readonly session: VendorSession,
		readonly icons: UiIconRepository,
		readonly reportFailure: (message: string) => void,
		/** Current accepted player-to-vendor distance, absent until both poses exist. */
		readonly distanceToVendor: (vendor: number) => number | null,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		const snapshot = session.vendorSnapshot();
		// Initial hydration recovers an interaction that arrived before this owner mounted.
		this.#visible = snapshot !== null;
		this.#replaceSnapshot(snapshot);
	}

	/** Latch observed vendor pose and close if the vendor vanished or moved out of reach. */
	reconcileRange(): void {
		if (this.#snapshot === null || !this.#visible) return;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (distance !== null) this.#hadVendorPose = true;
		if (this.#isClosedByRange(distance)) {
			this.close();
			return;
		}
		const canReachVendor = distance !== null;
		if (canReachVendor !== this.#canReachVendor) {
			this.#canReachVendor = canReachVendor;
			this.#syncView();
		}
	}

	read(): VendorView | null {
		if (!this.#visible || this.#snapshot === null || this.#draft === null)
			return null;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (this.#isClosedByRange(distance)) return null;
		const canReachVendor = distance !== null;
		return canReachVendor === this.#canReachVendor && this.#view !== null
			? this.#view
			: this.#buildView(canReachVendor);
	}

	/** Drag validation never treats an offer GUID as an owned entity. */
	canDragOffer(vendor: number, item: number): boolean {
		return (
			this.#editable() &&
			this.#snapshot?.vendor === vendor &&
			this.#catalog.has(item)
		);
	}
	acceptsDrop(vendor: number): boolean {
		return this.#editable() && this.#snapshot?.vendor === vendor;
	}

	queueBuy(item: number): void {
		if (!this.#editable() || this.#draft === null) return;
		const cell = this.#catalog.get(item);
		if (cell === undefined) return;
		if (cell.offer.stackable) {
			const existing =
				this.#draft.buys.find((line) => line.item === item)?.amount ?? 0;
			const finite = cell.offer.supply !== null;
			if (
				cell.offer.supply !== null &&
				cell.offer.supply < cell.offer.stack_count
			) {
				this.reportFailure(`${cell.name} is not available as a whole stack`);
				return;
			}
			if (finite && existing > 0) {
				this.reportFailure(`${cell.name} is already queued as one whole offer`);
				return;
			}
			const remaining = 0x7fff_ffff - existing;
			const maxAmount = finite ? cell.offer.stack_count : remaining;
			if (maxAmount < 1) {
				this.reportFailure("Purchase quantity exceeds the wire limit");
				return;
			}
			this.#quantityRequest = {
				item,
				name: cell.name,
				minAmount: finite ? maxAmount : 1,
				maxAmount,
				initialAmount: Math.min(cell.offer.stack_count, maxAmount),
			};
			this.#syncView();
			return;
		}
		this.#addBuy(item, cell.offer.stack_count);
	}

	confirmBuyQuantity(item: number, amount: number): void {
		const request = this.#quantityRequest;
		if (request?.item !== item || this.#draft === null) return;
		if (
			!Number.isInteger(amount) ||
			amount < request.minAmount ||
			amount > request.maxAmount
		) {
			this.reportFailure("Purchase quantity is outside the available range");
			return;
		}
		this.#quantityRequest = null;
		this.#addBuy(item, amount);
	}

	cancelBuyQuantity(): void {
		this.#quantityRequest = null;
		this.#syncView();
	}

	#addBuy(item: number, quantity: number): void {
		const cell = this.#catalog.get(item);
		if (cell === undefined || this.#draft === null) return;
		this.#purchases.set(item, cell);
		const draft = structuredClone(this.#draft);
		const existing = draft.buys.find((line) => line.item === item);
		const amount = (existing?.amount ?? 0) + quantity;
		if (existing === undefined) draft.buys.push({ item, amount });
		else existing.amount = amount;
		this.#request(draft, true);
	}

	/** Inventory dimming describes eligible contents for non-empty packs. */
	inventoryItemUnavailable(item: number): boolean {
		if (!this.#visible || this.#snapshot === null) return false;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (this.#isClosedByRange(distance)) return false;
		const selection = this.#saleSelection(this.#snapshot.vendor, item);
		return selection.kind !== "selected" || selection.items.length === 0;
	}

	acceptsSaleDrop(vendor: number, item: number): boolean {
		if (!this.acceptsDrop(vendor)) return false;
		const selection = this.#saleSelection(vendor, item);
		return selection.kind === "selected" && selection.items.length > 0;
	}

	#saleSelection(vendor: number, item: number): ClientOfferSelection {
		return selectOfferItems(
			this.session.entities.read(),
			item,
			(facts) =>
				facts.vendorSale?.vendor === vendor &&
				facts.vendorSale.accepted &&
				!this.#draft?.sells.includes(facts.guid),
		);
	}

	queueSell(item: number): void {
		if (!this.#editable() || this.#draft === null) return;
		const selection = this.#saleSelection(this.#draft.vendor, item);
		if (selection.kind === "unavailable") {
			this.reportFailure(selection.reason);
			return;
		}
		if (selection.items.length === 0) {
			this.reportFailure("No eligible items to queue for sale.");
			return;
		}
		for (const source of selection.items) {
			const description = source.description;
			const iconKey = this.icons.retain(this.#owner, {
				kind: "item",
				...description.icon,
				itemType: description.itemType,
			});
			this.#retained.add(iconKey);
			this.#sales.set(source.guid, { name: description.name, iconKey });
		}
		this.#request(
			{
				...this.#draft,
				sells: [
					...this.#draft.sells,
					...selection.items.map((item) => item.guid),
				],
			},
			true,
		);
	}

	/** Capture an exact draft and display group so drag-out cannot edit a replacement queue. */
	captureRemoval(key: string): (() => void) | null {
		if (!this.#editable() || this.#draft === null) return null;
		const cell = this.#queue().find((cell) => cell.key === key);
		if (cell === undefined) return null;
		const draft = this.#draft;
		const quote = this.#quote;
		return () => {
			if (this.#draft === draft && this.#quote === quote) this.remove(cell);
		};
	}

	remove(cell: VendorQueueCell): void {
		if (!this.#editable() || this.#draft === null) return;
		const sources = new Set(cell.sources);
		this.#draft =
			cell.side === "buy"
				? {
						...this.#draft,
						buys: this.#draft.buys.flatMap((line) =>
							!sources.has(line.item)
								? [line]
								: !cell.stackable && line.amount > 1
									? [{ ...line, amount: line.amount - 1 }]
									: [],
						),
					}
				: {
						...this.#draft,
						sells: this.#draft.sells.filter((id) => !sources.has(id)),
					};
		this.#request(this.#draft, false);
	}

	clear(): void {
		if (!this.#editable() || this.#draft === null) return;
		this.#draft = { vendor: this.#draft.vendor, buys: [], sells: [] };
		this.#request(this.#draft, false);
	}

	trade(): void {
		this.reconcileRange();
		if (!this.#visible || this.#snapshot === null || this.#draft === null)
			return;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (this.#isClosedByRange(distance)) return;
		if (!this.#canTrade(distance !== null, this.#queue().length)) return;
		const request = {
			sequence: sequence(),
			draft: structuredClone(this.#draft),
		};
		this.#execution = {
			sequence: request.sequence,
			phase: request.draft.sells.length > 0 ? "selling" : "buying",
		};
		this.#syncView();
		void this.session.submitVendor(request).catch((error: unknown) => {
			if (this.#execution?.sequence !== request.sequence || this.#disposed)
				return;
			this.#execution = null;
			this.#problem = `Trade request failed: ${String(error)}`;
			this.#syncView();
			this.reportFailure(this.#problem);
		});
	}

	close(): void {
		this.#visible = false;
		this.#entityLevel = null;
		this.#quantityRequest = null;
		this.#view = null;
		if (this.#execution === null && this.#draft !== null) {
			this.#draft = { vendor: this.#draft.vendor, buys: [], sells: [] };
			this.#retirePreview();
			this.#quote = null;
			this.#collectArtwork();
		}
	}

	destroy(): void {
		this.#disposed = true;
		this.#entityLevel = null;
		this.#view = null;
		this.#retirePreview();
		this.#unsubscribe();
		this.icons.releaseOwner(this.#owner);
	}

	#editable(): boolean {
		if (
			!this.#visible ||
			this.#snapshot === null ||
			this.#recovering ||
			this.#execution !== null ||
			this.#preview !== null ||
			this.#quantityRequest !== null
		)
			return false;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		return distance !== null && !this.#isClosedByRange(distance);
	}

	#isClosedByRange(distance: number | null): boolean {
		return (
			(distance === null && this.#hadVendorPose) ||
			(distance !== null &&
				distance > CLIENT_TUNING.vendor.maximumDistanceMeters)
		);
	}

	#canTrade(canReachVendor: boolean, queueLength: number): boolean {
		return (
			canReachVendor &&
			!this.#recovering &&
			this.#execution === null &&
			this.#preview === null &&
			this.#quantityRequest === null &&
			this.#problem === null &&
			this.#quote?.affordable === true &&
			queueLength > 0
		);
	}

	#buildView(canReachVendor: boolean): VendorView | null {
		if (!this.#visible || this.#snapshot === null || this.#draft === null)
			return null;
		const queue = this.#queue();
		const read = this.session.entities.read();
		const vendorEntity =
			read.kind === "current"
				? read.level.entities.get(this.#snapshot.vendor)
				: undefined;
		const name =
			vendorEntity?.description.kind === "known"
				? vendorEntity.description.name
				: "Vendor";
		return {
			vendor: this.#snapshot.vendor,
			name,
			sections: this.#sections,
			queue,
			quantityRequest: this.#quantityRequest,
			currency: this.#snapshot.currency,
			quote: this.#quote,
			currencyIconKeys: this.#currencyIcons,
			pending: this.#recovering || this.#preview !== null,
			phase: this.#execution?.phase ?? null,
			problem: this.#problem,
			canTrade: this.#canTrade(canReachVendor, queue.length),
			iconKeys: [
				...new Set(
					[...this.#catalog.values(), ...queue]
						.map((cell) => cell.iconKey)
						.concat([...this.#currencyIcons.values()]),
				),
			],
		};
	}

	#syncView(): void {
		if (!this.#visible || this.#snapshot === null || this.#draft === null) {
			this.#canReachVendor = false;
			this.#view = null;
			return;
		}
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (this.#isClosedByRange(distance)) {
			this.#canReachVendor = false;
			this.#view = null;
			return;
		}
		this.#canReachVendor = distance !== null;
		this.#view = this.#buildView(this.#canReachVendor);
	}

	#retirePreview(): void {
		if (this.#preview !== null) clearTimeout(this.#preview.timer);
		this.#preview = null;
	}

	/** Revalidation keeps the pending candidate and its original deadline. */
	#refreshQuote(): void {
		if (this.#visible && this.#draft !== null && this.#execution === null) {
			const pending = this.#preview;
			this.#request(
				pending?.draft ?? this.#draft,
				pending?.reportRejection ?? false,
			);
		}
	}

	#request(draft: VendorDraft, reportRejection: boolean): void {
		if (this.#recovering) return;
		const read = this.session.entities.read();
		// A hidden in-flight trade may request its final quote without retaining the world map.
		this.#entityLevel =
			this.#visible && read.kind === "current" ? read.level : null;
		const deadline =
			this.#preview?.deadline ??
			performance.now() + CLIENT_TUNING.vendor.previewTimeoutMs;
		this.#retirePreview();
		const pending: PendingPreview = {
			sequence: sequence(),
			draft,
			reportRejection,
			deadline,
			timer: setTimeout(
				() => {
					if (this.#preview !== pending) return;
					this.#retirePreview();
					this.#problem =
						"Vendor preview timed out. Your previous draft has been retained.";
					this.#collectArtwork();
					this.#syncView();
					this.reportFailure(this.#problem);
				},
				Math.max(0, deadline - performance.now()),
			),
		};
		this.#preview = pending;
		this.#syncView();
		void this.session
			.previewVendor({ sequence: pending.sequence, draft: pending.draft })
			.catch((error: unknown) => {
				if (this.#preview !== pending || this.#disposed) return;
				this.#retirePreview();
				this.#problem = `Vendor preview failed: ${String(error)}`;
				this.#collectArtwork();
				this.#syncView();
				if (reportRejection) this.reportFailure(this.#problem);
			});
	}

	#replaceSnapshot(snapshot: VendorSnapshot): void {
		const changed = snapshot?.vendor !== this.#snapshot?.vendor;
		this.#snapshot = snapshot;
		if (snapshot === null) {
			this.#visible = false;
			this.#entityLevel = null;
		}
		if (changed) {
			this.#hadVendorPose = false;
			this.#canReachVendor = false;
			this.#quantityRequest = null;
			this.#currencyIcons.clear();
			this.#draft =
				snapshot === null
					? null
					: { vendor: snapshot.vendor, buys: [], sells: [] };
			this.#retirePreview();
			this.#quote = null;
			this.#problem = null;
			this.#sales.clear();
			this.#purchases.clear();
		}
		this.#catalog = new Map(
			(snapshot?.offers ?? []).map((offer) => {
				const iconKey = this.icons.retain(this.#owner, {
					kind: "item",
					...offer.icon,
					itemType: offer.item_type ?? 0,
				});
				this.#retained.add(iconKey);
				return [offer.guid, { name: offer.name, iconKey, offer }];
			}),
		);
		const grouped = new Map<VendorCategory, VendorCatalogCell[]>();
		for (const cell of this.#catalog.values()) {
			const cells = grouped.get(cell.offer.category) ?? [];
			cells.push(cell);
			grouped.set(cell.offer.category, cells);
		}
		this.#sections = CATEGORY_LABELS.flatMap(([category, name]) => {
			const cells = grouped.get(category);
			return cells === undefined ? [] : [{ name, cells }];
		});
		this.#refreshQuote();
		this.#syncCurrencyArtwork();
		this.#syncView();
	}

	#syncCurrencyArtwork(): void {
		const read = this.session.entities.read();
		this.#retainCurrencyArtwork(
			read.kind === "current" ? read.level.entities : null,
		);
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "resyncing") {
			this.#recovering = true;
			this.#entityLevel = null;
			this.#retirePreview();
			this.#collectArtwork();
			this.#syncView();
		} else if (event.type === "current-state") {
			this.#recovering = false;
			this.#replaceSnapshot(this.session.vendorSnapshot());
		} else if (event.type === "entities") {
			const read = this.session.entities.read();
			if (this.#visible && read.kind === "current") {
				const changed = quoteInventoryChanged(this.#entityLevel, read.level);
				this.#entityLevel = read.level;
				if (changed) this.#refreshQuote();
				this.#retainCurrencyArtwork(read.level.entities);
				this.#syncView();
			}
		} else if (event.type === "trade-snapshot" && event.trade.trade !== null)
			this.close();
		else if (event.type === "vendor-approached") {
			this.#visible = true;
			this.#replaceSnapshot(event.vendor);
		} else if (event.type === "vendor-snapshot")
			this.#replaceSnapshot(event.vendor);
		else if (event.type === "vendor-preview") {
			const pending = this.#preview;
			if (
				pending === null ||
				event.result.sequence !== pending.sequence ||
				event.result.vendor !== this.#draft?.vendor
			)
				return;
			this.#retirePreview();
			if (event.result.outcome.kind === "ready") {
				this.#draft = pending.draft;
				this.#quote = event.result.outcome.quote;
				this.#problem = null;
			} else {
				if (pending.reportRejection)
					this.reportFailure(event.result.outcome.reason);
				else this.#problem = event.result.outcome.reason;
			}
			this.#syncCurrencyArtwork();
			this.#syncView();
		} else if (event.type === "vendor-phase" && this.#execution !== null) {
			this.#execution.phase = event.phase;
			this.#syncView();
		} else if (
			event.type === "vendor-result" &&
			event.result.sequence === this.#execution?.sequence
		) {
			this.#execution = null;
			const result = event.result;
			if (result.outcome.kind === "failed") {
				let message = result.outcome.message;
				if (result.outcome.phase === "buying") {
					const sale =
						result.sale_issue ?? (result.sold.length > 0 ? "Items sold" : null);
					message =
						sale === null
							? `Purchase failed. ${message}`
							: `${sale}; purchase failed. ${message}`;
				}
				this.reportFailure(message);
			} else if (result.sale_issue !== null) {
				this.reportFailure(`Purchase completed. ${result.sale_issue}`);
			}
			if (this.#draft !== null && this.#draft.vendor === result.vendor) {
				this.#draft = {
					...this.#draft,
					buys: result.outcome.kind === "completed" ? [] : this.#draft.buys,
					sells: this.#draft.sells.filter((id) => !result.sold.includes(id)),
				};
			}
			if (this.#draft !== null) this.#request(this.#draft, false);
			this.#syncView();
		} else if (
			event.type === "exit-requested" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.#execution = null;
			this.#replaceSnapshot(null);
		}
	}

	#queue(): VendorQueueCell[] {
		const draft = this.#draft;
		if (draft === null || this.#quote === null) return [];
		const groups = new Map<string, VendorQueueCell>();
		for (const side of ["buy", "sell"] as const) {
			const sources = new Set(
				side === "buy" ? draft.buys.map((line) => line.item) : draft.sells,
			);
			for (const line of side === "buy"
				? this.#quote.buys
				: this.#quote.sells) {
				if (!sources.has(line.item)) continue;
				const art =
					side === "buy"
						? this.#purchases.get(line.item)
						: this.#sales.get(line.item);
				if (art === undefined)
					throw new Error(
						`Queued vendor item ${line.item} has no retained artwork`,
					);
				if (side === "buy" && line.merge_key === null) {
					for (let copy = 0; copy < line.amount; copy++) {
						const key = `buy:item:${line.item}:${copy}`;
						groups.set(key, {
							...art,
							key,
							side,
							stackable: false,
							sources: [line.item],
							amount: 1,
							total: line.total / line.amount,
						});
					}
					continue;
				}
				const key = `${side}:${line.merge_key === null ? `item:${line.item}` : `stack:${line.merge_key}`}`;
				const previous = groups.get(key);
				groups.set(key, {
					key,
					side,
					stackable: line.merge_key !== null,
					name: art.name,
					iconKey: art.iconKey,
					sources: [line.item, ...(previous?.sources ?? [])],
					amount: (previous?.amount ?? 0) + line.amount,
					total: (previous?.total ?? 0) + line.total,
				});
			}
		}
		return [...groups.values()];
	}

	#collectArtwork(): void {
		const saleIds = new Set([
			...(this.#draft?.sells ?? []),
			...(this.#preview?.draft.sells ?? []),
		]);
		for (const id of this.#sales.keys())
			if (!saleIds.has(id)) this.#sales.delete(id);
		const purchaseIds = new Set(
			[...(this.#draft?.buys ?? []), ...(this.#preview?.draft.buys ?? [])].map(
				(line) => line.item,
			),
		);
		for (const id of this.#purchases.keys())
			if (!purchaseIds.has(id)) this.#purchases.delete(id);
		const retained = new Set(
			[
				...this.#catalog.values(),
				...this.#sales.values(),
				...this.#purchases.values(),
			]
				.map((cell) => cell.iconKey)
				.concat([...this.#currencyIcons.values()]),
		);
		for (const key of this.#retained)
			if (!retained.has(key)) this.icons.release(this.#owner, key);
		this.#retained = retained;
	}

	#retainCurrencyArtwork(
		entities: ReadonlyMap<number, ClientEntityFacts> | null,
	): void {
		const keys = new Map<number, string>();
		const wcids = new Set([
			...(this.#quote?.currencies.map((currency) => currency.wcid) ?? []),
			...(this.#snapshot === null ? [] : [this.#snapshot.currency.wcid]),
		]);
		for (const wcid of wcids) {
			const spec =
				wcid === 273
					? PYREAL_ICON_SPEC
					: (() => {
							const known = INVENTORY_CURRENCIES.find(
								([knownWcid]) => knownWcid === wcid,
							);
							if (known !== undefined)
								return { kind: "base" as const, base: known[2] };
							const offer = [...this.#catalog.values()].find(
								(cell) => cell.offer.wcid === wcid,
							)?.offer;
							if (offer !== undefined)
								return {
									kind: "item" as const,
									...offer.icon,
									itemType: offer.item_type ?? 0,
								};
							for (const entity of entities?.values() ?? []) {
								const description = entity.description;
								if (description.kind === "known" && description.wcid === wcid)
									return {
										kind: "item" as const,
										...description.icon,
										itemType: description.itemType,
									};
							}
							return null;
						})();
			if (spec !== null) {
				const key = this.icons.retain(this.#owner, spec);
				this.#retained.add(key);
				keys.set(wcid, key);
			}
		}
		this.#currencyIcons = keys;
		this.#collectArtwork();
	}
}
