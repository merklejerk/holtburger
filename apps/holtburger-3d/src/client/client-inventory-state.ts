import type {
	ItemIconOwner,
	ItemIconRepository,
} from "../app/item-icon-repository";
import type { ItemIconSpec } from "../app/item-icon-source";
import type { ClientEntityRead } from "./client-entity-mirror";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	clientInventoryMembership,
	clientInventorySections,
	clientInventoryPackSlots,
	sortInventoryItems,
	nextInventorySortMode,
	type ClientInventoryMembership,
	type ClientInventorySection,
	type InventorySortMode,
} from "./client-inventory-sections";
import type { ClientEntityFacts } from "./client-entity-mirror";
import { CLIENT_TUNING } from "./client-tuning";
import { PYREAL_ICON_SPEC } from "./client-inventory-art";
import {
	inventoryCurrencyTotals,
	type InventoryCurrencyTotal,
} from "./client-inventory-currencies";

/** Prepared aggregate with a repository-owned graphic reference. */
export interface InventoryCurrencyRow extends Omit<
	InventoryCurrencyTotal,
	"base"
> {
	readonly iconKey: string;
}

/** Existing lifecycle facts and semantic mirror; the model does not subscribe to raw properties. */
export interface InventoryLifecycle {
	readonly entities: { read(): ClientEntityRead };
	state(): { readonly lifecycle: ClientLifecycle | null };
	subscribe(listener: (event: ClientLifecycleSessionEvent) => void): () => void;
}

/** Cached membership and reference indices derived together from one accepted revision. */
interface InventoryBaseline {
	readonly currencies: readonly InventoryCurrencyRow[];
	readonly currenciesPending: boolean;
	readonly worldRevision: number;
	readonly playerGuid: number | null;
	readonly membership: ClientInventoryMembership | null;
	readonly iconKeys: ReadonlyMap<number, string>;
	readonly retainedKeys: ReadonlySet<string>;
}

/** Lazy, consumer-facing layout. Authoritative entities remain immutable mirror references. */
export interface ClientInventoryView {
	/** Ambient balances across all carried packs; pending prevents partial totals appearing final. */
	readonly currencies: readonly InventoryCurrencyRow[];
	readonly currenciesPending: boolean;
	readonly pending: boolean;
	readonly sortMode: InventorySortMode;
	readonly sections: readonly ClientInventorySection[];
	readonly packSlots: readonly (ClientEntityFacts | null)[];
	readonly iconKeys: ReadonlyMap<number, string>;
}

/** Session-owned preferences and icon references, independent of the active floating panel. */
export class ClientInventoryState {
	readonly icons: ItemIconRepository;
	/** Static footer artwork retained across panel closure and inventory resynchronization. */
	readonly pyrealIconKey: string;
	readonly #lifecycle: InventoryLifecycle;
	readonly #owner: ItemIconOwner;
	readonly #unsubscribe: () => void;
	readonly #timer: ReturnType<typeof setInterval>;
	#baseline: InventoryBaseline | null = null;
	#pending = true;
	#sortMode: InventorySortMode = "native";
	#view: ClientInventoryView | null = null;
	#disposed = false;

	constructor(lifecycle: InventoryLifecycle, icons: ItemIconRepository) {
		this.#lifecycle = lifecycle;
		this.icons = icons;
		this.#owner = icons.createOwner("persistent");
		this.pyrealIconKey = icons.retain(this.#owner, PYREAL_ICON_SPEC);
		this.#unsubscribe = lifecycle.subscribe((event) => {
			const state =
				event.type === "lifecycle"
					? event.lifecycle
					: event.type === "current-state"
						? event.state.lifecycle
						: null;
			if (state !== null && isInitialEntry(state)) this.#reset();
		});
		this.#refresh();
		this.#timer = setInterval(
			() => this.#refresh(),
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
	}

	/** Group and sort only when a mounted consumer asks; hidden maintenance does neither. */
	read(): ClientInventoryView {
		if (this.#view !== null) return this.#view;
		const membership = this.#baseline?.membership ?? null;
		const sections = clientInventorySections(membership).map((section) => ({
			...section,
			items: sortInventoryItems(section.items, this.#sortMode),
			packs: sortInventoryItems(section.packs, this.#sortMode),
			unslotted: sortInventoryItems(section.unslotted, this.#sortMode),
		}));
		this.#view = Object.freeze({
			currencies: this.#baseline?.currencies ?? [],
			currenciesPending:
				this.#pending || (this.#baseline?.currenciesPending ?? true),
			pending: this.#pending,
			sortMode: this.#sortMode,
			sections,
			packSlots: clientInventoryPackSlots(membership),
			iconKeys: this.#baseline?.iconKeys ?? new Map(),
		});
		return this.#view;
	}

	cycleSort(): void {
		this.#sortMode = nextInventorySortMode(this.#sortMode);
		this.#view = null;
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		clearInterval(this.#timer);
		this.#unsubscribe();
		this.icons.releaseOwner(this.#owner);
		this.#baseline = null;
		this.#view = null;
	}

	#reset(): void {
		// Entry/initial-entry may both arrive; resetting an empty baseline is idempotent.
		if (this.#baseline !== null) {
			for (const key of this.#baseline.retainedKeys)
				this.icons.release(this.#owner, key);
			this.#baseline = null;
		}
		this.#pending = true;
		this.#view = null;
	}

	#refresh(): void {
		const lifecycle = this.#lifecycle.state().lifecycle;
		const read = this.#lifecycle.entities.read();
		const usable =
			lifecycle?.kind === "in-world" ||
			(lifecycle?.kind === "portal-space" &&
				lifecycle.cause !== "initial-entry");
		const pending = !usable || read.kind === "pending";
		if (pending !== this.#pending) {
			this.#pending = pending;
			this.#view = null;
		}
		if (pending || read.kind !== "current") return;
		const level = read.level;
		if (this.#baseline?.worldRevision === level.revision) return;
		if (
			this.#baseline !== null &&
			this.#baseline.playerGuid !== level.playerGuid
		)
			this.#reset();
		const membership = clientInventoryMembership(level);
		const iconKeys = new Map<number, string>();
		const retainedKeys = new Set<string>();
		const currencyTotals = inventoryCurrencyTotals(level);
		const currencies = currencyTotals.totals.map(({ base, ...total }) => {
			const iconKey = this.icons.retain(this.#owner, {
				kind: "base",
				base,
			});
			retainedKeys.add(iconKey);
			return { ...total, iconKey };
		});
		for (const entity of membership?.members ?? []) {
			const description = entity.description;
			if (description.kind !== "known") continue;
			const { overlay, underlay, uiEffects, base } = description.icon;
			const spec: ItemIconSpec =
				entity.guid === level.playerGuid
					? { kind: "main-pack", overlay, underlay, uiEffects }
					: {
							kind: "item",
							base,
							itemType: description.itemType,
							overlay,
							underlay,
							uiEffects,
						};
			const key = this.icons.retain(this.#owner, spec);
			iconKeys.set(entity.guid, key);
			retainedKeys.add(key);
		}
		// Acquiring the entire new membership first prevents same-icon A-to-B eviction.
		for (const key of this.#baseline?.retainedKeys ?? []) {
			if (!retainedKeys.has(key)) this.icons.release(this.#owner, key);
		}
		this.#baseline = {
			currencies,
			currenciesPending: currencyTotals.pending,
			worldRevision: level.revision,
			playerGuid: level.playerGuid,
			membership,
			iconKeys,
			retainedKeys,
		};
		this.#pending = false;
		this.#view = null;
	}
}

function isInitialEntry(lifecycle: ClientLifecycle): boolean {
	return (
		lifecycle.kind === "entering-world" ||
		(lifecycle.kind === "portal-space" && lifecycle.cause === "initial-entry")
	);
}
