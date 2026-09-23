import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type { ClientEntityFacts } from "./client-entity-mirror";
import { PYREAL_ICON_SPEC } from "./client-inventory-art";
import { INVENTORY_CURRENCIES } from "./client-inventory-currencies";
import { CLIENT_TUNING } from "./client-tuning";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	VendorDraft,
	VendorOffer,
	VendorPhase,
	VendorQuote,
	VendorSnapshot,
} from "./client-vendor-contract";

/** Retail VendorItemsUI::OpenVendor (acclient.c:233475); presentation order is app-local. */
const CATEGORIES = [
	["Armor", 0x2],
	["Books, Paper", 0x2000],
	["Clothing", 0x4],
	["Containers", 0x200],
	["Food", 0x20],
	["Gems", 0x800],
	["Jewelry", 0x8],
	["Keys, Tools", 0x20004000],
	["Miscellaneous", 0x490],
	["Services", 0x100000],
	["Spell Components", 0x1000],
	["Trade Notes", 0x40000],
	["Weapons", 0x101],
	["Mana Stones", 0x80000],
	["Magic Items", 0x8000],
	["Alchemical Items", 0x4800000],
	["Cooking Items", 0x400000],
	["Fletching Items", 0x9000000],
] as const;

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
}

let nextSequence = 0;
function sequence(): number {
	if (nextSequence === 0xffff_ffff)
		throw new Error("Vendor request sequence exhausted");
	return ++nextSequence;
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
	#sales = new Map<number, CellArtwork>();
	#purchases = new Map<number, CellArtwork>();
	#currencyIcons = new Map<number, string>();
	#quantityRequest: VendorQuantityRequest | null = null;
	#retained = new Set<string>();
	#visible = false;
	#problem: string | null = null;
	#view: VendorView | null = null;
	#inventoryRevision = -1;
	/** Distinguishes initial pose hydration from a vendor that disappeared later. */
	#hadVendorPose = false;
	/** Cached reach availability invalidates the quote view when poses arrive. */
	#canReachVendor = false;
	#disposed = false;

	constructor(
		readonly session: VendorSession,
		readonly icons: UiIconRepository,
		readonly reportFailure: (message: string) => void,
		/** Current accepted player-to-vendor distance, absent until both poses exist. */
		readonly distanceToVendor: (vendor: number) => number | null,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		this.#replaceSnapshot(session.vendorSnapshot());
	}

	read(): VendorView | null {
		if (!this.#visible || this.#snapshot === null || this.#draft === null)
			return null;
		const canReachVendor = this.#checkRange();
		if (!this.#visible) return null;
		const read = this.session.entities.read();
		if (
			read.kind === "current" &&
			read.level.revision !== this.#inventoryRevision
		) {
			this.#inventoryRevision = read.level.revision;
			this.#view = null;
			if (this.#execution === null && this.#preview === null)
				this.#request(this.#draft, false);
		}
		if (this.#view !== null) return this.#view;
		const grouped = new Map<string, VendorCatalogCell[]>();
		for (const cell of this.#catalog.values()) {
			// First matching retail category prevents a composite type appearing twice.
			const category =
				CATEGORIES.find(
					([, mask]) =>
						cell.offer.item_type !== null &&
						(cell.offer.item_type & mask) !== 0,
				)?.[0] ?? "Other";
			const cells = grouped.get(category) ?? [];
			cells.push(cell);
			grouped.set(category, cells);
		}
		const sections = [...CATEGORIES.map(([name]) => name), "Other"].flatMap(
			(name) => {
				const cells = grouped.get(name);
				return cells === undefined ? [] : [{ name, cells }];
			},
		);
		const queue = this.#queue();
		this.#retainCurrencyArtwork(
			read.kind === "current" ? read.level.entities : null,
		);
		const vendorEntity =
			read.kind === "current"
				? read.level.entities.get(this.#snapshot.vendor)
				: undefined;
		const name =
			vendorEntity?.description.kind === "known"
				? vendorEntity.description.name
				: "Vendor";
		this.#view = {
			vendor: this.#snapshot.vendor,
			name,
			sections,
			queue,
			quantityRequest: this.#quantityRequest,
			currency: this.#snapshot.currency,
			quote: this.#quote,
			currencyIconKeys: this.#currencyIcons,
			pending: this.#preview !== null,
			phase: this.#execution?.phase ?? null,
			problem: this.#problem,
			canTrade:
				canReachVendor &&
				this.#execution === null &&
				this.#preview === null &&
				this.#quantityRequest === null &&
				this.#problem === null &&
				this.#quote?.affordable === true &&
				queue.length > 0,
			iconKeys: [
				...new Set(
					[...this.#catalog.values(), ...queue]
						.map((cell) => cell.iconKey)
						.concat([...this.#currencyIcons.values()]),
				),
			],
		};
		return this.#view;
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
			this.#view = null;
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
		this.#view = null;
		this.#addBuy(item, amount);
	}

	cancelBuyQuantity(): void {
		this.#quantityRequest = null;
		this.#view = null;
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

	queueSell(item: number): void {
		if (
			!this.#editable() ||
			this.#draft === null ||
			this.#draft.sells.includes(item)
		)
			return;
		const read = this.session.entities.read();
		const source =
			read.kind === "current" ? read.level.entities.get(item) : undefined;
		if (source?.description.kind !== "known" || !source.ownedByPlayer) {
			this.reportFailure(
				"Only your own described items can be queued for sale",
			);
			return;
		}
		const description = source.description;
		const iconKey = this.icons.retain(this.#owner, {
			kind: "item",
			...description.icon,
			itemType: description.itemType,
		});
		this.#retained.add(iconKey);
		this.#sales.set(item, { name: description.name, iconKey });
		this.#request(
			{ ...this.#draft, sells: [...this.#draft.sells, item] },
			true,
		);
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
		if (this.read()?.canTrade !== true || this.#draft === null) return;
		const request = {
			sequence: sequence(),
			draft: structuredClone(this.#draft),
		};
		this.#execution = {
			sequence: request.sequence,
			phase: request.draft.sells.length > 0 ? "selling" : "buying",
		};
		this.#view = null;
		void this.session.submitVendor(request).catch((error: unknown) => {
			if (this.#execution?.sequence !== request.sequence || this.#disposed)
				return;
			this.#execution = null;
			this.#problem = `Trade request failed: ${String(error)}`;
			this.#view = null;
			this.reportFailure(this.#problem);
		});
	}

	close(): void {
		this.#visible = false;
		this.#quantityRequest = null;
		this.#view = null;
		if (this.#execution === null && this.#draft !== null) {
			this.#draft = { vendor: this.#draft.vendor, buys: [], sells: [] };
			this.#preview = null;
			this.#quote = null;
			this.#collectArtwork();
		}
	}

	destroy(): void {
		this.#disposed = true;
		this.#unsubscribe();
		this.icons.releaseOwner(this.#owner);
	}

	#editable(): boolean {
		return (
			this.#visible &&
			this.#checkRange() &&
			this.#execution === null &&
			this.#preview === null &&
			this.#quantityRequest === null
		);
	}

	/** Closing after a known pose disappears avoids a stale shop after vendor unload. */
	#checkRange(): boolean {
		if (this.#snapshot === null || !this.#visible) return false;
		const distance = this.distanceToVendor(this.#snapshot.vendor);
		if (distance !== null) this.#hadVendorPose = true;
		if (
			(distance === null && this.#hadVendorPose) ||
			(distance !== null &&
				distance > CLIENT_TUNING.vendor.maximumDistanceMeters)
		) {
			this.close();
			return false;
		}
		const canReachVendor = distance !== null;
		if (canReachVendor !== this.#canReachVendor) {
			this.#canReachVendor = canReachVendor;
			this.#view = null;
		}
		return canReachVendor;
	}

	#request(draft: VendorDraft, reportRejection: boolean): void {
		const pending = { sequence: sequence(), draft, reportRejection };
		this.#preview = pending;
		this.#view = null;
		void this.session
			.previewVendor({ sequence: pending.sequence, draft: pending.draft })
			.catch((error: unknown) => {
				if (this.#preview !== pending || this.#disposed) return;
				this.#preview = null;
				this.#problem = `Vendor preview failed: ${String(error)}`;
				this.#view = null;
				if (reportRejection) this.reportFailure(this.#problem);
			});
	}

	#replaceSnapshot(snapshot: VendorSnapshot): void {
		const changed = snapshot?.vendor !== this.#snapshot?.vendor;
		this.#snapshot = snapshot;
		this.#visible = snapshot !== null;
		this.#view = null;
		if (changed) {
			this.#hadVendorPose = false;
			this.#canReachVendor = false;
			this.#quantityRequest = null;
			this.#currencyIcons.clear();
			this.#draft =
				snapshot === null
					? null
					: { vendor: snapshot.vendor, buys: [], sells: [] };
			this.#preview = null;
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
		if (this.#draft !== null && this.#execution === null) {
			const pending = this.#preview;
			this.#request(
				pending?.draft ?? this.#draft,
				pending?.reportRejection ?? false,
			);
		}
		this.#collectArtwork();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "vendor-snapshot") this.#replaceSnapshot(event.vendor);
		else if (event.type === "vendor-preview") {
			const pending = this.#preview;
			if (
				pending === null ||
				event.result.sequence !== pending.sequence ||
				event.result.vendor !== this.#draft?.vendor
			)
				return;
			this.#preview = null;
			if (event.result.outcome.kind === "ready") {
				this.#draft = pending.draft;
				this.#quote = event.result.outcome.quote;
				this.#problem = null;
			} else {
				if (pending.reportRejection)
					this.reportFailure(event.result.outcome.reason);
				else this.#problem = event.result.outcome.reason;
			}
			this.#view = null;
			this.#collectArtwork();
		} else if (event.type === "vendor-phase" && this.#execution !== null) {
			this.#execution.phase = event.phase;
			this.#view = null;
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
			this.#view = null;
		} else if (
			event.type === "exit-requested" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.#replaceSnapshot(null);
			this.#execution = null;
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
