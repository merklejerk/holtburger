import { z } from "zod";
import {
	selectOfferItems,
	type ClientOfferSelection,
} from "./client-offer-selection";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type { ClientEntityRead } from "./client-entity-mirror";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

const unsigned = z.number().int().nonnegative().max(0xffff_ffff);
const side = z
	.object({ guid: unsigned, accepted: z.boolean(), items: z.array(unsigned) })
	.strict();

/** World-owned offers and revision; presentation never counts item changes to infer freshness. */
const tradeStateSchema = z
	.object({
		revision: unsigned,
		partner_guid: unsigned,
		initiator_guid: unsigned,
		self_side: side,
		partner_side: side,
	})
	.strict();

/** Shared acknowledgment waits travel with confirmed offers at both publication boundaries. */
export const tradeSnapshotSchema = z
	.object({
		trade: tradeStateSchema.nullable(),
		pending_items: z.array(unsigned),
	})
	.strict();

/** Same guarded command contract used by the TUI and H3D. */
export const tradeRequestSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("open"), partner: unsigned }).strict(),
	z
		.object({
			kind: z.literal("add"),
			partner: unsigned,
			revision: unsigned,
			items: z.array(unsigned).nonempty(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("accept"),
			partner: unsigned,
			revision: unsigned,
		})
		.strict(),
	z.object({ kind: z.literal("withdraw"), partner: unsigned }).strict(),
	z.object({ kind: z.literal("reset"), partner: unsigned }).strict(),
	z.object({ kind: z.literal("close"), partner: unsigned }).strict(),
]);

export type TradeState = z.infer<typeof tradeStateSchema>;
export type TradeSnapshot = z.infer<typeof tradeSnapshotSchema>;
export type TradeRequest = z.infer<typeof tradeRequestSchema>;

/** Session-owned authority required by the HUD; independent of mounted window lifetime. */
export type TradeSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "state" | "tradeSnapshot" | "submitTrade" | "entities"
>;

/** A confirmed offer identity can precede its description. */
interface TradeCell {
	readonly guid: number;
	readonly name: string;
	readonly count: number;
	readonly iconKey: string | null;
	readonly described: boolean;
}

/** Bounded HUD snapshot; acceptance names the revision actually displayed. */
export interface TradeView {
	readonly trade: TradeState;
	readonly partnerName: string;
	/** Local character name displayed in the mirrored offer header. */
	readonly ownName: string;
	readonly own: readonly TradeCell[];
	readonly partner: readonly TradeCell[];
	readonly pendingItems: number;
	readonly ready: boolean;
	readonly canAccept: boolean;
	readonly iconKeys: readonly string[];
}

/** App-local offer gestures and artwork. Shared core owns every trade rule and wire action. */
export class ClientTradeState {
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	#snapshot: TradeSnapshot;
	#itemIcons = new Map<number, string>();
	#retained = new Set<string>();
	#view: TradeView | null = null;
	#recovering = false;
	#destroyed = false;

	constructor(
		readonly session: TradeSession,
		readonly icons: UiIconRepository,
		readonly reportFailure: (message: string) => void,
	) {
		this.#snapshot = session.tradeSnapshot();
		this.#owner = icons.createOwner("persistent");
		this.#sync();
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): TradeView | null {
		return this.#view;
	}

	open(partner: number): void {
		this.#submit({ kind: "open", partner });
	}

	/** Inventory highlighting uses the same current offer admission as a drop, without preparing artwork. */
	inventoryItemUnavailable(item: number): boolean {
		const trade = this.#snapshot.trade;
		return (
			trade !== null &&
			!this.acceptsDrop(trade.partner_guid, trade.revision, item)
		);
	}

	/** The same pack selection controls dimming, hover admission, and release. */
	#selection(
		partner: number,
		revision: number,
		item: number,
	): ClientOfferSelection {
		const trade = this.#snapshot.trade;
		if (
			this.#recovering ||
			this.session.state().lifecycle?.kind !== "in-world" ||
			trade === null ||
			trade.partner_guid !== partner ||
			trade.revision !== revision ||
			(trade.self_side.accepted && trade.partner_side.accepted)
		)
			return {
				kind: "unavailable",
				reason: "That trade offer is no longer available.",
			};
		return selectOfferItems(
			this.session.entities.read(),
			item,
			(facts) =>
				facts.canOfferTrade &&
				!trade.self_side.items.includes(facts.guid) &&
				!this.#snapshot.pending_items.includes(facts.guid),
		);
	}

	/** A drop captures the exact offer revision so a reset cannot retarget an old gesture. */
	acceptsDrop(partner: number, revision: number, item: number): boolean {
		const selection = this.#selection(partner, revision, item);
		return selection.kind === "selected" && selection.items.length > 0;
	}

	add(partner: number, revision: number, item: number): void {
		const selection = this.#selection(partner, revision, item);
		if (selection.kind === "unavailable") {
			this.reportFailure(selection.reason);
			return;
		}
		if (selection.items.length === 0) {
			this.reportFailure("No eligible items to add to this trade.");
			return;
		}
		this.#submit({
			kind: "add",
			partner,
			revision,
			items: selection.items.map((item) => item.guid),
		});
	}

	accept(revision: number): void {
		const trade = this.#snapshot.trade;
		if (trade === null || !this.#canAccept()) return;
		this.#submit({
			kind: "accept",
			partner: trade.partner_guid,
			revision,
		});
	}
	withdraw(): void {
		if (this.#isReady() && this.#snapshot.trade !== null)
			this.#submit({
				kind: "withdraw",
				partner: this.#snapshot.trade.partner_guid,
			});
	}
	reset(): void {
		if (this.#isReady() && this.#snapshot.trade !== null)
			this.#submit({
				kind: "reset",
				partner: this.#snapshot.trade.partner_guid,
			});
	}
	close(): void {
		if (this.#isReady() && this.#snapshot.trade !== null)
			this.#submit({
				kind: "close",
				partner: this.#snapshot.trade.partner_guid,
			});
	}

	destroy(): void {
		this.#destroyed = true;
		this.#unsubscribe();
		this.icons.releaseOwner(this.#owner);
	}

	#isReady(read: ClientEntityRead = this.session.entities.read()): boolean {
		return (
			!this.#recovering &&
			read.kind === "current" &&
			this.session.state().lifecycle?.kind === "in-world"
		);
	}

	#canAccept(read: ClientEntityRead = this.session.entities.read()): boolean {
		const trade = this.#snapshot.trade;
		if (
			trade === null ||
			!this.#isReady(read) ||
			this.#snapshot.pending_items.length !== 0 ||
			trade.self_side.accepted ||
			read.kind !== "current"
		)
			return false;
		return [...trade.self_side.items, ...trade.partner_side.items].every(
			(guid) => read.level.entities.get(guid)?.description.kind === "known",
		);
	}

	#sync(): void {
		const trade = this.#snapshot.trade;
		const read = this.session.entities.read();
		const nextItemIcons = new Map<number, string>();
		const nextRetained = new Set<string>();
		if (trade !== null && read.kind === "current") {
			for (const guid of [
				...trade.self_side.items,
				...trade.partner_side.items,
			]) {
				const description = read.level.entities.get(guid)?.description;
				if (description?.kind !== "known") continue;
				const iconKey = this.icons.retain(this.#owner, {
					kind: "item",
					...description.icon,
					itemType: description.itemType,
				});
				nextItemIcons.set(guid, iconKey);
				nextRetained.add(iconKey);
			}
		}
		for (const key of this.#retained)
			if (!nextRetained.has(key)) this.icons.release(this.#owner, key);
		this.#itemIcons = nextItemIcons;
		this.#retained = nextRetained;
		if (trade === null) {
			this.#view = null;
			return;
		}
		const cells = (ids: readonly number[]): TradeCell[] =>
			ids.map((guid) => {
				const description =
					read.kind === "current"
						? read.level.entities.get(guid)?.description
						: undefined;
				if (description?.kind !== "known")
					return {
						guid,
						name: `Awaiting item 0x${guid.toString(16)}`,
						count: 1,
						iconKey: null,
						described: false,
					};
				return {
					guid,
					name: description.name,
					count: description.stackCount ?? 1,
					iconKey: this.#itemIcons.get(guid) ?? null,
					described: true,
				};
			});
		const partnerDescription =
			read.kind === "current"
				? read.level.entities.get(trade.partner_guid)?.description
				: undefined;
		this.#view = {
			trade,
			own: cells(trade.self_side.items),
			partner: cells(trade.partner_side.items),
			ready: this.#isReady(read),
			partnerName:
				partnerDescription?.kind === "known"
					? partnerDescription.name
					: `Player 0x${trade.partner_guid.toString(16)}`,
			ownName:
				this.session.state().playerName ??
				`Player 0x${trade.self_side.guid.toString(16)}`,
			pendingItems: this.#snapshot.pending_items.length,
			canAccept: this.#canAccept(read),
			iconKeys: [...this.#retained],
		};
	}

	#submit(request: TradeRequest): void {
		void this.session.submitTrade(request).catch((error: unknown) => {
			if (this.#destroyed) return;
			this.reportFailure(`Trade request failed: ${String(error)}`);
		});
	}

	#replace(snapshot: TradeSnapshot): void {
		this.#snapshot = snapshot;
		this.#sync();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "trade-snapshot") this.#replace(event.trade);
		else if (event.type === "entities") this.#sync();
		else if (event.type === "resyncing") {
			this.#recovering = true;
			this.#sync();
		} else if (event.type === "current-state") {
			this.#recovering = false;
			this.#replace(this.session.tradeSnapshot());
		} else if (event.type === "exit-requested") {
			this.#replace({ trade: null, pending_items: [] });
		} else if (event.type === "lifecycle") {
			if (event.lifecycle.kind !== "in-world")
				this.#replace({ trade: null, pending_items: [] });
			else this.#sync();
		}
	}
}
