import { formatError } from "../lib/format-error";
import {
	ContentsArrivals,
	type ContentsArrival,
} from "./client-contents-arrivals";
import { retainContentsVisuals } from "./client-contents-visuals";
import { clientInventoryMembership } from "./client-inventory-sections";
import type { ItemCapacity } from "../app/item-capacity";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type {
	ClientEntityRead,
	ClientEntityFacts,
	ProjectileSupply,
} from "./client-entity-mirror";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import {
	contentsSections,
	contentsPackSlots,
	nextContentsSortMode,
	type ClientContentsMembership,
	type ClientContentsSection,
	type ContentsSortMode,
} from "./client-container-contents";
import { CLIENT_TUNING } from "./client-tuning";
import { PYREAL_ICON_SPEC } from "./client-inventory-art";
import {
	inventoryEquipment,
	type InventoryEquipment,
} from "./client-inventory-equipment";
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

/** Session commands and results shared by inventory gestures and container actions. */
export type InventoryInteractionSession = Pick<
	ClientLifecycleSession,
	"previewInventory" | "submitInventory" | "autoMergeContainer" | "subscribe"
>;

/** Existing lifecycle facts and semantic mirror; the model does not subscribe to raw properties. */
export interface InventoryLifecycle extends InventoryInteractionSession {
	readonly entities: { read(): ClientEntityRead };
	state(): { readonly lifecycle: ClientLifecycle | null };
}

/** Coherent owned item/artwork lookup without sorting inventory presentation. */
interface ClientInventoryItems {
	/** Confirmed character identity lets session-local bindings retire on replacement snapshots. */
	readonly playerGuid: number | null;
	/** Only currently usable owned items; bindings keep missing identities themselves. */
	readonly items: ReadonlyMap<number, ClientEntityFacts>;
	/** Known container occupancy shared by every item-cell consumer. */
	readonly capacities: ReadonlyMap<number, ItemCapacity>;
	/** Prepared persistent artwork belonging to the same accepted baseline. */
	readonly iconKeys: ReadonlyMap<number, string>;
}

/** Cached membership and reference indices derived together from one accepted revision. */
interface InventoryBaseline {
	/** Owned item lookup shared by inventory and action binding consumers. */
	readonly items: ReadonlyMap<number, ClientEntityFacts>;
	/** Known container occupancy shared by every item-cell consumer. */
	readonly capacities: ReadonlyMap<number, ItemCapacity>;
	readonly equipment: InventoryEquipment;
	readonly currencies: readonly InventoryCurrencyRow[];
	readonly currenciesPending: boolean;
	readonly worldRevision: number;
	readonly playerGuid: number | null;
	readonly membership: ClientContentsMembership | null;
	readonly iconKeys: ReadonlyMap<number, string>;
	readonly retainedKeys: ReadonlySet<string>;
}

/** Lazy, consumer-facing layout. Authoritative entities remain immutable mirror references. */
export interface ClientInventoryView {
	/** Fixed slot rows, independent of container capacity and contents sorting. */
	readonly equipment: InventoryEquipment;
	/** Ambient balances across all carried packs; pending prevents partial totals appearing final. */
	readonly currencies: readonly InventoryCurrencyRow[];
	readonly currenciesPending: boolean;
	readonly pending: boolean;
	readonly sortMode: ContentsSortMode;
	/** Known ordinary-slot occupancy for every displayed container, including nested ones. */
	readonly capacities: ReadonlyMap<number, ItemCapacity>;
	readonly sections: readonly ClientContentsSection[];
	readonly packSlots: readonly (ClientEntityFacts | null)[];
	readonly iconKeys: ReadonlyMap<number, string>;
}

/** Session-owned preferences and icon references, independent of the active floating panel. */
export class ClientInventoryState {
	readonly icons: UiIconRepository;
	/** App-owned toast delivery for rejected gestures and transport failures. */
	readonly reportFailure: (message: string) => void;
	/** Session capability consumed by the inventory split dialog. */
	readonly interactions: InventoryInteractionSession;
	/** Static footer artwork retained across panel closure and inventory resynchronization. */
	readonly pyrealIconKey: string;
	readonly #lifecycle: InventoryLifecycle;
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	readonly #timer: ReturnType<typeof setInterval>;
	#baseline: InventoryBaseline | null = null;
	#pending = true;
	#sortMode: ContentsSortMode = "native";
	#view: ClientInventoryView | null = null;
	#disposed = false;
	/** Arrival history follows the accepted inventory lifetime, independent of mounted panels. */
	readonly #arrivals = new ContentsArrivals();
	readonly #arrivalListeners = new Set<(arrivals: ContentsArrival) => void>();

	constructor(
		lifecycle: InventoryLifecycle,
		icons: UiIconRepository,
		reportFailure: (message: string) => void,
	) {
		this.reportFailure = reportFailure;
		this.#lifecycle = lifecycle;
		this.interactions = lifecycle;
		this.icons = icons;
		this.#owner = icons.createOwner("persistent");
		this.pyrealIconKey = icons.retain(this.#owner, PYREAL_ICON_SPEC);
		this.#unsubscribe = lifecycle.subscribe((event) => {
			if (event.type === "resyncing") this.#arrivals.update([], true);
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

	/** Notifications are live-only: opening a panel never replays unseen arrivals. */
	subscribeArrivals(receive: (arrivals: ContentsArrival) => void): () => void {
		this.#arrivalListeners.add(receive);
		return () => {
			this.#arrivalListeners.delete(receive);
		};
	}

	/** Group and sort only when a mounted consumer asks; hidden maintenance does neither. */
	read(): ClientInventoryView {
		if (this.#view !== null) return this.#view;
		const membership = this.#baseline?.membership ?? null;
		const sections = contentsSections(membership, "pack-slots", this.#sortMode);
		this.#view = Object.freeze({
			equipment: this.#baseline?.equipment ?? { rows: [], pending: true },
			currencies: this.#baseline?.currencies ?? [],
			currenciesPending:
				this.#pending || (this.#baseline?.currenciesPending ?? true),
			pending: this.#pending,
			sortMode: this.#sortMode,
			sections,
			capacities: this.#baseline?.capacities ?? new Map(),
			packSlots: contentsPackSlots(membership),
			iconKeys: this.#baseline?.iconKeys ?? new Map(),
		});
		return this.#view;
	}

	/** Action bars consume item facts without building hidden inventory sections. */
	readItems(): ClientInventoryItems {
		this.#refresh();
		if (this.#pending || this.#baseline === null)
			return {
				playerGuid: null,
				items: new Map(),
				iconKeys: new Map(),
				capacities: new Map(),
			};
		return this.#baseline;
	}

	/** Current owned item facts, independent of panel visibility and sorting. */
	readItem(guid: number): ClientEntityFacts | undefined {
		this.#refresh();
		return this.#pending ? undefined : this.#baseline?.items.get(guid);
	}

	/** Bounded HUD readers consume world semantics without building inventory layouts. */
	readProjectileSupply(): ProjectileSupply {
		this.#refresh();
		const read = this.#lifecycle.entities.read();
		return this.#pending || read.kind === "pending"
			? { kind: "pending", appraisal: null }
			: read.level.projectileSupply;
	}

	/** Local-player world ratio for bounded HUD sampling, without sorting inventory contents. */
	readBurden(): number | null {
		this.#refresh();
		if (this.#pending) return null;
		const description = this.#baseline?.membership?.root.description;
		return description?.kind === "known" ? description.burden : null;
	}

	/** Only actual carried storage and Main Pack expose the app-local context command. */
	canAutoMergeContainer(guid: number): boolean {
		this.#refresh();
		if (this.#pending || this.#baseline === null) return false;
		const { playerGuid, membership } = this.#baseline;
		const item =
			guid === playerGuid ? membership?.root : this.#baseline.items.get(guid);
		if (
			item === undefined ||
			item.description.kind !== "known" ||
			item.storage.kind !== "container" ||
			item.storage.roster !== "announced" ||
			item.storage.itemCapacity === null ||
			item.storage.itemCapacity <= 0
		)
			return false;
		return (
			guid === playerGuid ||
			(item.ownedByPlayer &&
				item.location.kind === "contained" &&
				item.location.parentGuid === playerGuid &&
				item.location.slot.kind === "pack" &&
				item.location.slot.entryKind === "container")
		);
	}

	/** Recheck a menu identity against current membership before crossing the host boundary. */
	async autoMergeContainer(guid: number): Promise<void> {
		if (!this.canAutoMergeContainer(guid))
			throw new Error("That bag is no longer available for auto-merge.");
		await this.interactions.autoMergeContainer(guid);
	}

	/** UI entry points share transport/admission failure feedback as well as execution. */
	requestAutoMergeContainer(guid: number): void {
		void this.autoMergeContainer(guid).catch((error: unknown) => {
			this.reportFailure(formatError(error));
		});
	}

	cycleSort(): void {
		this.#sortMode = nextContentsSortMode(this.#sortMode);
		this.#view = null;
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#arrivalListeners.clear();
		clearInterval(this.#timer);
		this.#unsubscribe();
		this.icons.releaseOwner(this.#owner);
		this.#baseline = null;
		this.#view = null;
	}

	#reset(): void {
		this.#arrivals.update([], true);
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
		if (pending || read.kind !== "current") {
			this.#arrivals.update([], true);
			return;
		}
		const level = read.level;
		if (this.#baseline?.worldRevision === level.revision) return;
		if (
			this.#baseline !== null &&
			this.#baseline.playerGuid !== level.playerGuid
		)
			this.#reset();
		const membership = clientInventoryMembership(level);
		const equipment = inventoryEquipment(level);
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
		const visibleEntities = new Map(
			(membership?.members ?? []).map((entity) => [entity.guid, entity]),
		);
		for (const { item } of equipment.rows)
			if (item !== null) visibleEntities.set(item.guid, item);
		const visuals = retainContentsVisuals(
			visibleEntities.values(),
			membership,
			level.playerGuid,
			this.icons,
			this.#owner,
		);
		const { capacities, iconKeys } = visuals;
		for (const key of visuals.retainedKeys) retainedKeys.add(key);
		// Acquiring the entire new membership first prevents same-icon A-to-B eviction.
		for (const key of this.#baseline?.retainedKeys ?? []) {
			if (!retainedKeys.has(key)) this.icons.release(this.#owner, key);
		}
		this.#baseline = {
			items: visibleEntities,
			capacities,
			equipment,
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
		const arrivals = this.#arrivals.update(
			membership === null
				? []
				: [membership.root, ...membership.containers].map((container) => ({
						container,
						children: membership.children.get(container.guid) ?? [],
					})),
			false,
		);
		if (arrivals.size > 0)
			for (const receive of this.#arrivalListeners) receive(arrivals);
	}
}

function isInitialEntry(lifecycle: ClientLifecycle): boolean {
	return (
		lifecycle.kind === "entering-world" ||
		(lifecycle.kind === "portal-space" && lifecycle.cause === "initial-entry")
	);
}
