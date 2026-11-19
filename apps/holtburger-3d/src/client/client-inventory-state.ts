import { z } from "zod";
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
	PlayerEntitySummary,
	ProjectileSupply,
} from "./client-entity-mirror";
import type { ClientLifecycle } from "./client-host-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import {
	contentsSections,
	contentsPackSlots,
	nextContentsSortMode,
	type ClientContentsMembership,
	type ClientContentsSection,
	type ContentsSortMode,
} from "./client-container-contents";
import { PYREAL_ICON_SPEC } from "./client-inventory-art";
import {
	inventoryEquipment,
	type InventoryEquipment,
} from "./client-inventory-equipment";
import {
	inventoryCurrencyTotals,
	type InventoryCurrencyTotal,
} from "./client-inventory-currencies";

const unsigned = z.number().int().min(0).max(0xffff_ffff);

/** Identity-based destinations mirror the shared core intent, never browser array indices. */
const inventoryTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unequip") }),
	z.object({ kind: z.literal("pickup"), container: unsigned.nullable() }),
	z.object({ kind: z.literal("ground") }),
	z.object({ kind: z.literal("give"), guid: unsigned }),
	z.object({ kind: z.literal("split"), amount: unsigned.positive() }),
	z.object({ kind: z.literal("item"), guid: unsigned }),
	z.object({ kind: z.literal("stack"), guid: unsigned }),
	z.object({ kind: z.literal("container"), guid: unsigned }),
	z.object({ kind: z.literal("equipment"), mask: unsigned }),
	z
		.object({
			kind: z.literal("equip-preferred"),
			alternate: z.boolean().optional(),
		})
		.strict(),
	z.object({ kind: z.literal("pack"), guid: unsigned }),
]);

/** One inventory gesture submitted to the shared evaluator. */
export const inventoryIntentSchema = z.object({
	item: unsigned,
	target: inventoryTargetSchema,
});

/** Correlates asynchronous previews with the current gesture target. */
export const inventoryPreviewRequestSchema = z.object({
	sequence: unsigned,
	intent: inventoryIntentSchema,
});

/** Shared semantic consequence; presentation only adds its local sort-mode restriction. */
export const inventoryPreviewResultSchema = z.object({
	sequence: unsigned,
	preview: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("split"), max_amount: unsigned.positive() }),
		z.object({ kind: z.literal("noop") }),
		z.object({ kind: z.literal("merge"), amount: unsigned.positive() }),
		z.object({ kind: z.literal("move") }),
		z.object({ kind: z.literal("drop") }),
		z.object({ kind: z.literal("give") }),
		z.object({ kind: z.literal("equip"), displaced: z.array(unsigned) }),
		z.object({ kind: z.literal("swap") }),
		z.object({ kind: z.literal("rejected"), reason: z.string() }),
	]),
});

/** Validated preview request at the app-local boundary. */
export type ClientInventoryPreviewRequest = z.infer<
	typeof inventoryPreviewRequestSchema
>;
/** Validated consequence returned by core. */
export type ClientInventoryPreviewResult = z.infer<
	typeof inventoryPreviewResultSchema
>;

/** One item and its semantic destination. */
export type ClientInventoryIntent = z.infer<typeof inventoryIntentSchema>;

// All panel interaction owners share an identity space across mounts and dialog lifetimes.
let previewSequence = 0;
/** Allocate a unique correlation identity for inventory previews. */
export function nextInventoryPreviewSequence(): number {
	if (previewSequence === 0xffff_ffff)
		throw new Error("Inventory preview sequence exhausted");
	return ++previewSequence;
}

/** Application-chosen finite deadlines; mirrored by core's validated policy. */
export const autoMergePolicySchema = z
	.object({
		stepTimeoutMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
		operationTimeoutMs: z
			.number()
			.int()
			.positive()
			.max(Number.MAX_SAFE_INTEGER),
	})
	.strict();

/** One container invocation; the browser does not plan individual stack transfers. */
export const autoMergeRequestSchema = z
	.object({
		container: unsigned,
		policy: autoMergePolicySchema,
	})
	.strict();

/** Prepared aggregate with a repository-owned graphic reference. */
export interface InventoryCurrencyRow extends Omit<
	InventoryCurrencyTotal,
	"base"
> {
	readonly iconKey: string;
}

/** Lifecycle and entity notifications consumed by inventory state, without full delta payloads. */
export type InventoryLifecycleEvent =
	| { readonly type: "entities" }
	| Exclude<ClientLifecycleSessionEvent, { readonly type: "entities" }>;

/** Session commands and results shared by inventory gestures and container actions. */
export type InventoryInteractionSession = Pick<
	ClientLifecycleSession,
	"previewInventory" | "submitInventory" | "autoMergeContainer"
> & {
	subscribe(listener: (event: InventoryLifecycleEvent) => void): () => void;
};

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
	readonly player: PlayerEntitySummary;
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
	readonly player: PlayerEntitySummary;
	readonly pending: boolean;
	readonly sortMode: ContentsSortMode;
	/** Known ordinary-slot occupancy for every displayed container, including nested ones. */
	readonly capacities: ReadonlyMap<number, ItemCapacity>;
	readonly sections: readonly ClientContentsSection[];
	readonly packSlots: readonly (ClientEntityFacts | null)[];
	readonly iconKeys: ReadonlyMap<number, string>;
}

const EMPTY_PLAYER_SUMMARY: PlayerEntitySummary = {
	pyrealBalance: null,
	burden: null,
	aetheriaActivation: null,
};

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
			if (event.type === "resyncing") {
				this.#arrivals.update([], true);
				this.#refresh();
			} else if (event.type === "entities") {
				this.#refresh();
			} else if (event.type === "current-state") {
				if (isInitialEntry(event.state.lifecycle)) this.#reset();
				this.#refresh();
			} else if (event.type === "lifecycle") {
				if (isInitialEntry(event.lifecycle)) this.#reset();
				else this.#refresh();
			} else if (event.type === "exit-requested") {
				this.#reset();
			}
		});
		this.#refresh();
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
			player: this.#baseline?.player ?? EMPTY_PLAYER_SUMMARY,
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
		return this.#pending ? undefined : this.#baseline?.items.get(guid);
	}

	/** Bounded HUD readers consume world semantics without building inventory layouts. */
	readProjectileSupply(): ProjectileSupply {
		const read = this.#lifecycle.entities.read();
		return this.#pending || read.kind === "pending"
			? { kind: "pending", appraisal: null }
			: read.level.projectileSupply;
	}

	/** Local-player world ratio for bounded HUD sampling, without sorting inventory contents. */
	readBurden(): number | null {
		return this.#pending ? null : (this.#baseline?.player.burden ?? null);
	}

	/** Only actual carried storage and Main Pack expose the app-local context command. */
	canAutoMergeContainer(guid: number): boolean {
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
			player: level.player,
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
