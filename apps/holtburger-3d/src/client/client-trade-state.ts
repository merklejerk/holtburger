import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	TradeRequest,
	TradeSnapshot,
	TradeState,
} from "./client-trade-contract";

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
	#retained = new Set<string>();
	#recovering = false;
	#destroyed = false;

	constructor(
		readonly session: TradeSession,
		readonly icons: UiIconRepository,
		readonly reportFailure: (message: string) => void,
	) {
		this.#snapshot = session.tradeSnapshot();
		this.#owner = icons.createOwner("persistent");
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): TradeView | null {
		const trade = this.#snapshot.trade;
		if (trade === null) return null;
		const read = this.session.entities.read();
		const ready =
			!this.#recovering &&
			read.kind === "current" &&
			this.session.state().lifecycle?.kind === "in-world";
		const keys = new Set<string>();
		const cells = (ids: readonly number[]): TradeCell[] =>
			ids.map((guid) => {
				const facts =
					read.kind === "current" ? read.level.entities.get(guid) : undefined;
				const description = facts?.description;
				if (description?.kind !== "known")
					return {
						guid,
						name: `Awaiting item 0x${guid.toString(16)}`,
						count: 1,
						iconKey: null,
						described: false,
					};
				const iconKey = this.icons.retain(this.#owner, {
					kind: "item",
					...description.icon,
					itemType: description.itemType,
				});
				keys.add(iconKey);
				return {
					guid,
					name: description.name,
					count: description.stackCount ?? 1,
					iconKey,
					described: true,
				};
			});
		const own = cells(trade.self_side.items);
		const partner = cells(trade.partner_side.items);
		for (const key of this.#retained)
			if (!keys.has(key)) this.icons.release(this.#owner, key);
		this.#retained = keys;
		const partnerDescription =
			read.kind === "current"
				? read.level.entities.get(trade.partner_guid)?.description
				: undefined;
		return {
			trade,
			own,
			partner,
			ready,
			partnerName:
				partnerDescription?.kind === "known"
					? partnerDescription.name
					: `Player 0x${trade.partner_guid.toString(16)}`,
			ownName:
				this.session.state().playerName ??
				`Player 0x${trade.self_side.guid.toString(16)}`,
			pendingItems: this.#snapshot.pending_items.length,
			canAccept:
				ready &&
				this.#snapshot.pending_items.length === 0 &&
				!trade.self_side.accepted &&
				[...own, ...partner].every((cell) => cell.described),
			iconKeys: [...keys],
		};
	}

	open(partner: number): void {
		this.#submit({ kind: "open", partner });
	}

	/** A drop captures the exact offer revision so a reset cannot retarget an old gesture. */
	acceptsDrop(partner: number, revision: number, item: number): boolean {
		const read = this.session.entities.read();
		return (
			!this.#recovering &&
			read.kind === "current" &&
			this.session.state().lifecycle?.kind === "in-world" &&
			this.#snapshot.trade?.partner_guid === partner &&
			this.#snapshot.trade.revision === revision &&
			!(
				this.#snapshot.trade.self_side.accepted &&
				this.#snapshot.trade.partner_side.accepted
			) &&
			!this.#snapshot.trade.self_side.items.includes(item) &&
			!this.#snapshot.pending_items.includes(item) &&
			read.level.entities.get(item)?.canOfferTrade === true
		);
	}

	add(partner: number, revision: number, item: number): void {
		if (!this.acceptsDrop(partner, revision, item)) {
			this.reportFailure(
				"That item cannot join the current trade. Offer an owned item or empty container.",
			);
			return;
		}
		this.#submit({ kind: "add", partner, revision, item });
	}

	accept(revision: number): void {
		const view = this.read();
		if (view === null || !view.canAccept) return;
		this.#submit({
			kind: "accept",
			partner: view.trade.partner_guid,
			revision,
		});
	}
	withdraw(): void {
		if (this.read()?.ready && this.#snapshot.trade !== null)
			this.#submit({
				kind: "withdraw",
				partner: this.#snapshot.trade.partner_guid,
			});
	}
	reset(): void {
		if (this.read()?.ready && this.#snapshot.trade !== null)
			this.#submit({
				kind: "reset",
				partner: this.#snapshot.trade.partner_guid,
			});
	}
	close(): void {
		if (this.read()?.ready && this.#snapshot.trade !== null)
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

	#submit(request: TradeRequest): void {
		void this.session.submitTrade(request).catch((error: unknown) => {
			if (this.#destroyed) return;
			this.reportFailure(`Trade request failed: ${String(error)}`);
		});
	}

	#replace(snapshot: TradeSnapshot): void {
		this.#snapshot = snapshot;
		if (snapshot.trade === null) {
			for (const key of this.#retained) this.icons.release(this.#owner, key);
			this.#retained.clear();
		}
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "trade-snapshot") this.#replace(event.trade);
		else if (event.type === "resyncing") {
			this.#recovering = true;
		} else if (event.type === "current-state") {
			this.#recovering = false;
			this.#replace(this.session.tradeSnapshot());
		} else if (
			event.type === "exit-requested" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.#replace({ trade: null, pending_items: [] });
		}
	}
}
