import type {
	EquipmentCantripState,
	RankedCantripTier,
} from "../app/item-cantrip-contract.js";
import type { ItemCantripLookup } from "../app/item-cantrips";
import type {
	AppraisalRequest,
	FactsAppraisalPriority,
} from "./client-appraisal-requests";
import type {
	EquipmentCacheSnapshot,
	EquipmentCacheTier,
} from "./client-equipment-cache-contract";
import type { ClientEquipmentCacheTransport } from "./client-equipment-cache-transport";
import type { ClientEntityRead } from "./client-entity-mirror";
import type { ClientLifecycleSessionState } from "./client-lifecycle-session";

type ClientLifecycle = ClientLifecycleSessionState["lifecycle"];

export type ClientEquipmentAppraisalSessionEvent =
	| { readonly type: "appraisal-facts-settled"; readonly guid: number }
	| { readonly type: string };

/** Narrow session surface needed to reconcile equipment cantrip tiers and background appraisals. */
export interface ClientEquipmentAppraisalSession {
	readonly entities: { read(): ClientEntityRead };
	readonly appraisals: {
		requestFacts(
			guid: number,
			priority?: FactsAppraisalPriority,
		): AppraisalRequest;
	};
	state(): { readonly lifecycle: ClientLifecycle };
	tradeSnapshot(): {
		readonly trade: {
			readonly partner_side: { readonly items: readonly number[] };
		} | null;
	};
	vendorSnapshot(): {
		readonly offers: readonly {
			readonly guid: number;
			readonly equipment_cantrip: EquipmentCantripState | null;
		}[];
	} | null;
	subscribe(
		listener: (event: ClientEquipmentAppraisalSessionEvent) => void,
	): () => void;
}

interface AppraisalCandidate {
	readonly guid: number;
	readonly state: EquipmentCantripState;
	/** Ownership gates on-disk persistence; cache lookup and display stay visible for any item. */
	readonly persist: boolean;
	/** Priority lane for cold background polling, or `null` when only cached/live state displays. */
	readonly priority: FactsAppraisalPriority | null;
}

function mapsEqual(
	a: ReadonlyMap<number, RankedCantripTier>,
	b: ReadonlyMap<number, RankedCantripTier>,
): boolean {
	if (a.size !== b.size) return false;
	for (const [key, value] of a) {
		if (b.get(key) !== value) return false;
	}
	return true;
}

function isPlayableLifecycle(lifecycle: ClientLifecycle): boolean {
	if (lifecycle === null) return false;
	return (
		lifecycle.kind === "in-world" ||
		(lifecycle.kind === "portal-space" && lifecycle.cause !== "initial-entry")
	);
}

/**
 * Coordinates per-server equipment cantrip persistence and cold background
 * `FactsOnly` appraisals for unappraised equipment items across owned gear,
 * open world containers, partner trades, and vendor catalogs.
 */
export class ClientEquipmentAppraisals implements ItemCantripLookup {
	readonly #session: ClientEquipmentAppraisalSession;
	readonly #transport: ClientEquipmentCacheTransport;
	readonly #onChange: () => void;

	readonly #cache = new Map<number, EquipmentCacheTier>();
	readonly #persisted = new Map<number, EquipmentCacheTier>();
	readonly #liveResolved = new Set<number>();
	readonly #pendingFacts = new Map<number, AppraisalRequest>();
	readonly #attemptedMisses = new Set<number>();
	#visibleTiers = new Map<number, RankedCantripTier>();
	#cacheReady = false;
	#disposed = false;
	readonly #unsubscribe: () => void;

	constructor(
		session: ClientEquipmentAppraisalSession,
		transport: ClientEquipmentCacheTransport,
		onChange: () => void = () => undefined,
	) {
		this.#session = session;
		this.#transport = transport;
		this.#onChange = onChange;
		this.#unsubscribe = session.subscribe((event) => {
			if (event.type === "appraisal-facts-settled" && "guid" in event) {
				this.#pendingFacts.delete(event.guid);
				return;
			}
			if (event.type === "resyncing") {
				this.#cancelPending();
				this.#attemptedMisses.clear();
				this.#reconcile();
				return;
			}
			if (
				event.type === "entities" ||
				event.type === "current-state" ||
				event.type === "lifecycle" ||
				event.type === "trade-snapshot" ||
				event.type === "vendor-approached" ||
				event.type === "vendor-snapshot"
			) {
				this.#reconcile();
			}
		});
		void this.#loadCache();
		this.#reconcile();
	}

	/** Highest ranked intrinsic cantrip tier for a visible equipment item. */
	tierFor(guid: number | null): RankedCantripTier | undefined {
		if (guid === null || this.#disposed) return undefined;
		return this.#visibleTiers.get(guid);
	}

	/** Stops listening and cancels any queued background cantrip appraisals. */
	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
		this.#cancelPending();
		this.#attemptedMisses.clear();
		if (this.#visibleTiers.size > 0) {
			this.#visibleTiers.clear();
			this.#onChange();
		}
	}

	async #loadCache(): Promise<void> {
		let snapshot: EquipmentCacheSnapshot = {};
		try {
			snapshot = await this.#transport.readAll();
		} catch {
			// Fall back to live in-memory appraisal if persisted cache cannot be read.
		}
		if (this.#disposed) return;
		for (const [key, tier] of Object.entries(snapshot)) {
			const guid = Number(key);
			if (!Number.isSafeInteger(guid) || guid <= 0) continue;
			this.#persisted.set(guid, tier);
			if (!this.#liveResolved.has(guid)) {
				this.#cache.set(guid, tier);
			}
		}
		this.#cacheReady = true;
		this.#reconcile();
	}

	#reconcile(): void {
		if (this.#disposed) return;
		const lifecycle = this.#session.state().lifecycle;
		const playable = isPlayableLifecycle(lifecycle);
		const canPollFacts = lifecycle?.kind === "in-world";
		const read = this.#session.entities.read();
		if (!playable || read.kind !== "current") {
			this.#cancelPending();
			this.#attemptedMisses.clear();
			if (this.#visibleTiers.size > 0) {
				this.#visibleTiers = new Map();
				this.#onChange();
			}
			return;
		}

		const partnerTradeGuids = new Set(
			this.#session.tradeSnapshot().trade?.partner_side.items ?? [],
		);
		const worldContainer: AppraisalCandidate[] = [];
		const owned: AppraisalCandidate[] = [];
		const partnerTrade: AppraisalCandidate[] = [];
		const vendorOffers: AppraisalCandidate[] = [];
		const passiveVisible: AppraisalCandidate[] = [];
		const seenGuids = new Set<number>();

		for (const [guid, record] of read.level.entities) {
			if (record.description.kind !== "known") continue;
			const state = record.description.equipmentCantrip;
			if (state === null) continue;
			seenGuids.add(guid);
			if (record.worldContainerContent) {
				worldContainer.push({
					guid,
					state,
					persist: false,
					priority: { kind: "world-container" },
				});
			} else if (record.ownedByPlayer) {
				owned.push({
					guid,
					state,
					persist: true,
					priority: { kind: "owned-equipment" },
				});
			} else if (partnerTradeGuids.has(guid)) {
				partnerTrade.push({
					guid,
					state,
					persist: false,
					priority: { kind: "partner-trade" },
				});
			} else {
				passiveVisible.push({
					guid,
					state,
					persist: false,
					priority: null,
				});
			}
		}

		for (const offer of this.#session.vendorSnapshot()?.offers ?? []) {
			if (seenGuids.has(offer.guid) || offer.equipment_cantrip === null) {
				continue;
			}
			seenGuids.add(offer.guid);
			vendorOffers.push({
				guid: offer.guid,
				state: offer.equipment_cantrip,
				persist: false,
				priority: { kind: "vendor-offer" },
			});
		}

		const nextVisible = new Map<number, RankedCantripTier>();
		const activeAutoPollUnappraised = new Set<number>();

		// Queue auto-polls in strict priority order: world containers -> owned -> partner trades -> vendor catalog.
		for (const candidate of [
			...worldContainer,
			...owned,
			...partnerTrade,
			...vendorOffers,
			...passiveVisible,
		]) {
			this.#reconcileCandidate(
				candidate,
				canPollFacts,
				nextVisible,
				activeAutoPollUnappraised,
			);
		}

		for (const guid of this.#pendingFacts.keys()) {
			if (!activeAutoPollUnappraised.has(guid)) {
				this.#cancelOne(guid);
			}
		}
		for (const guid of this.#attemptedMisses) {
			if (!activeAutoPollUnappraised.has(guid)) {
				this.#attemptedMisses.delete(guid);
			}
		}

		if (!mapsEqual(this.#visibleTiers, nextVisible)) {
			this.#visibleTiers = nextVisible;
			this.#onChange();
		}
	}

	#reconcileCandidate(
		candidate: AppraisalCandidate,
		canPollFacts: boolean,
		nextVisible: Map<number, RankedCantripTier>,
		activeAutoPollUnappraised: Set<number>,
	): void {
		const { guid, state, persist, priority } = candidate;

		if (state.kind === "known") {
			this.#liveResolved.add(guid);
			this.#settleOne(guid);
			this.#attemptedMisses.delete(guid);
			this.#cache.set(guid, state.highestTier);
			if (
				persist &&
				(!this.#persisted.has(guid) ||
					this.#persisted.get(guid) !== state.highestTier)
			) {
				this.#persisted.set(guid, state.highestTier);
				this.#transport.stage({ guid, highestTier: state.highestTier });
			}
			if (state.highestTier !== null) {
				nextVisible.set(guid, state.highestTier);
			}
			return;
		}

		if (state.kind === "incomplete") {
			this.#settleOne(guid);
			this.#attemptedMisses.delete(guid);
			return;
		}

		// state.kind === "unappraised"
		if (this.#cache.has(guid)) {
			this.#settleOne(guid);
			this.#attemptedMisses.delete(guid);
			const cachedTier = this.#cache.get(guid) ?? null;
			if (cachedTier !== null) {
				nextVisible.set(guid, cachedTier);
			}
			return;
		}

		if (!canPollFacts || priority === null) return;
		activeAutoPollUnappraised.add(guid);

		const existing = this.#pendingFacts.get(guid);
		if (existing !== undefined) {
			existing.setPriority?.(priority);
			return;
		}
		if (this.#cacheReady && !this.#attemptedMisses.has(guid)) {
			this.#attemptedMisses.add(guid);
			const request = this.#session.appraisals.requestFacts(guid, priority);
			this.#pendingFacts.set(guid, request);
			void request.sent.catch(() => {
				if (this.#pendingFacts.get(guid) === request) {
					this.#pendingFacts.delete(guid);
				}
			});
		}
	}

	#settleOne(guid: number): void {
		const request = this.#pendingFacts.get(guid);
		if (request === undefined) return;
		this.#pendingFacts.delete(guid);
		if (request.settle !== undefined) {
			request.settle();
		} else {
			request.cancel();
		}
	}

	#cancelOne(guid: number): void {
		const request = this.#pendingFacts.get(guid);
		if (request === undefined) return;
		this.#pendingFacts.delete(guid);
		request.cancel();
	}

	#cancelPending(): void {
		for (const request of this.#pendingFacts.values()) {
			request.cancel();
		}
		this.#pendingFacts.clear();
	}
}
