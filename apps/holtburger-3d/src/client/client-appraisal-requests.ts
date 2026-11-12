import { CLIENT_APPRAISAL_TUNING } from "./client-appraisal-tuning";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type { ObjectInspectionResult } from "./client-object-inspection-contract";

/** Appraisal demand routed through core's unified IdentifyObject queue. */
export type AppraisalDemand = "full" | "facts-only";

/** Priority metadata for frontend background `FactsOnly` appraisal scheduling. */
export type FactsAppraisalPriority =
	| { readonly kind: "world-container" }
	| {
			readonly kind: "combat-health";
			readonly lastAttackedAtMs: number | null;
			readonly distanceMeters: number | null;
	  }
	| { readonly kind: "owned-equipment" }
	| { readonly kind: "partner-trade" }
	| { readonly kind: "vendor-offer" }
	| { readonly kind: "default" };

const DEFAULT_FACTS_PRIORITY: FactsAppraisalPriority = { kind: "default" };

const FACTS_LANE_RANK: Record<FactsAppraisalPriority["kind"], number> = {
	"world-container": 0,
	"combat-health": 1,
	"owned-equipment": 2,
	"partner-trade": 3,
	"vendor-offer": 4,
	default: 5,
};

/** Optional modifiers for foreground `Full` appraisals. */
export interface FullAppraisalOptions {
	/** Allow suppressing duplicate creature previews when inputs have not changed. */
	readonly refresh?: boolean;
}

/** Optional scheduling policy overrides for `ClientAppraisalRequests`. */
export interface ClientAppraisalRequestOptions {
	/** Fallback release bound if core expires a `FactsOnly` slot without an entity update. */
	readonly factsTimeoutMs?: number;
}

/** Transport seam backing deduplicated client appraisal requests. */
export interface ClientAppraisalTransport {
	readonly sendFull: (guid: number, refresh: boolean) => Promise<void>;
	readonly sendFacts: (guid: number) => Promise<void>;
	readonly cancel: (guid: number, demand: AppraisalDemand) => Promise<void>;
}

/** One consumer's interest in shared appraisal work; cancellation notifies core when last. */
export interface AppraisalRequest {
	/** Transport acceptance or pre-dispatch cancellation. */
	readonly sent: Promise<void>;
	/** Retire this consumer; cancels queued core work when no consumers remain for this demand. */
	cancel(): void;
	/** Retire this consumer after facts arrived locally without sending a host cancellation. */
	readonly settle?: () => void;
	/** Optional live priority update while a `FactsOnly` demand awaits dispatch. */
	readonly setPriority?: (priority: FactsAppraisalPriority) => void;
}

interface PendingFullAppraisal {
	sent: Promise<void>;
	refresh: boolean;
	dispatched: boolean;
	readonly consumers: Set<(result: ObjectInspectionResult) => void>;
}

interface PendingFactsAppraisal {
	readonly guid: number;
	readonly sequence: number;
	readonly sent: Promise<void>;
	readonly resolveSent: () => void;
	readonly rejectSent: (error: unknown) => void;
	sentSettled: boolean;
	dispatched: boolean;
	settledLocally: boolean;
	readonly consumers: Map<symbol, FactsAppraisalPriority>;
}

interface ActiveFactsSlot {
	readonly guid: number;
	readonly entry: PendingFactsAppraisal;
	readonly watchdog: ReturnType<typeof setTimeout>;
}

function compareNullableDescending(a: number | null, b: number | null): number {
	const aValid = a !== null && Number.isFinite(a);
	const bValid = b !== null && Number.isFinite(b);
	if (aValid && bValid) return b - a;
	if (aValid) return -1;
	if (bValid) return 1;
	return 0;
}

function compareNullableAscending(a: number | null, b: number | null): number {
	const aValid = a !== null && Number.isFinite(a);
	const bValid = b !== null && Number.isFinite(b);
	if (aValid && bValid) return a - b;
	if (aValid) return -1;
	if (bValid) return 1;
	return 0;
}

/** Strict total order over `FactsAppraisalPriority` (negative means `a` runs before `b`). */
export function compareFactsPriority(
	a: FactsAppraisalPriority,
	b: FactsAppraisalPriority,
): number {
	const rankDiff = FACTS_LANE_RANK[a.kind] - FACTS_LANE_RANK[b.kind];
	if (rankDiff !== 0) return rankDiff;
	if (a.kind === "combat-health" && b.kind === "combat-health") {
		const attackDiff = compareNullableDescending(
			a.lastAttackedAtMs,
			b.lastAttackedAtMs,
		);
		if (attackDiff !== 0) return attackDiff;
		return compareNullableAscending(a.distanceMeters, b.distanceMeters);
	}
	return 0;
}

function effectiveEntryPriority(
	entry: PendingFactsAppraisal,
): FactsAppraisalPriority {
	let best: FactsAppraisalPriority | null = null;
	for (const priority of entry.consumers.values()) {
		if (best === null || compareFactsPriority(priority, best) < 0) {
			best = priority;
		}
	}
	return best ?? DEFAULT_FACTS_PRIORITY;
}

/**
 * Session-local appraisal deduplication and priority scheduling across TS consumers.
 *
 * Foreground `Full` vs background `FactsOnly` preemption and server cooldown pacing live in core's
 * `AppraisalSystem`. TS keeps at most one `FactsOnly` request dispatched into core at a time so
 * higher-priority container and combat health queries never stall behind bulk vendor or inventory
 * queues.
 */
export class ClientAppraisalRequests {
	readonly #transport: ClientAppraisalTransport;
	readonly #factsTimeoutMs: number;
	readonly #pendingFull = new Map<number, PendingFullAppraisal>();
	readonly #pendingFacts = new Map<number, PendingFactsAppraisal>();
	#activeFacts: ActiveFactsSlot | null = null;
	#flushScheduled = false;
	#factsSequence = 0;
	#playerGuid: number | null = null;

	constructor(
		transport: ClientAppraisalTransport,
		options?: ClientAppraisalRequestOptions,
	) {
		this.#transport = transport;
		this.#factsTimeoutMs =
			options?.factsTimeoutMs ??
			CLIENT_APPRAISAL_TUNING.responseTimeoutMs + 250;
	}

	/** Subscribe before dispatch; callers handle send failures and cancel when their purpose ends. */
	request(
		guid: number,
		receive: (result: ObjectInspectionResult) => void,
		options?: FullAppraisalOptions,
	): AppraisalRequest {
		const refresh = options?.refresh ?? false;
		let pending = this.#pendingFull.get(guid);
		if (pending === undefined) {
			const consumers = new Set<(result: ObjectInspectionResult) => void>();
			const entry: PendingFullAppraisal = {
				sent: Promise.resolve(),
				refresh,
				dispatched: false,
				consumers,
			};
			// Deferral registers every same-turn consumer before transport dispatch begins.
			entry.sent = Promise.resolve().then(async () => {
				if (this.#pendingFull.get(guid) !== entry) return;
				if (consumers.size === 0) {
					this.#pendingFull.delete(guid);
					return;
				}
				entry.dispatched = true;
				await this.#transport.sendFull(guid, entry.refresh);
			});
			pending = entry;
			this.#pendingFull.set(guid, entry);
			void entry.sent.catch(() => {
				if (this.#pendingFull.get(guid) === entry)
					this.#pendingFull.delete(guid);
				consumers.clear();
			});
		} else if (!pending.dispatched) {
			pending.refresh = pending.refresh && refresh;
		}
		const current = pending;
		// Each call owns a distinct subscription even if callers supply the same function.
		const consumer = (result: ObjectInspectionResult) => receive(result);
		current.consumers.add(consumer);
		return {
			sent: current.sent,
			cancel: () => {
				if (!current.consumers.delete(consumer)) return;
				if (current.consumers.size > 0) return;
				if (this.#pendingFull.get(guid) !== current) return;
				this.#pendingFull.delete(guid);
				if (current.dispatched) {
					void this.#transport.cancel(guid, "full").catch(() => {});
				}
			},
		};
	}

	/** Request background facts-only appraisal scheduled by priority without delivering inspector results. */
	requestFacts(
		guid: number,
		priority: FactsAppraisalPriority = DEFAULT_FACTS_PRIORITY,
	): AppraisalRequest {
		let pending = this.#pendingFacts.get(guid);
		if (pending === undefined) {
			let resolveSent!: () => void;
			let rejectSent!: (error: unknown) => void;
			const sent = new Promise<void>((resolve, reject) => {
				resolveSent = resolve;
				rejectSent = reject;
			});
			// Prevent unhandled-rejection noise if callers cancel/reset before attaching handlers.
			void sent.catch(() => {});
			pending = {
				guid,
				sequence: ++this.#factsSequence,
				sent,
				resolveSent,
				rejectSent,
				sentSettled: false,
				dispatched: false,
				settledLocally: false,
				consumers: new Map(),
			};
			this.#pendingFacts.set(guid, pending);
		}
		const current = pending;
		const token = Symbol("facts-consumer");
		current.consumers.set(token, priority);
		this.#scheduleFactsFlush();

		const retireConsumer = (settledLocally: boolean) => {
			if (!current.consumers.delete(token)) return;
			if (settledLocally) current.settledLocally = true;
			if (current.consumers.size > 0) return;
			if (this.#pendingFacts.get(guid) !== current) return;
			this.#pendingFacts.delete(guid);
			this.#resolveSentOnce(current);
			const wasActive = this.#activeFacts?.entry === current;
			if (wasActive) {
				this.#clearActiveFacts();
			}
			if (current.dispatched && !current.settledLocally) {
				void this.#transport.cancel(guid, "facts-only").catch(() => {});
			}
			if (wasActive) {
				this.#scheduleFactsFlush();
			}
		};

		return {
			sent: current.sent,
			setPriority: (nextPriority: FactsAppraisalPriority) => {
				if (!current.consumers.has(token)) return;
				current.consumers.set(token, nextPriority);
			},
			settle: () => retireConsumer(true),
			cancel: () => retireConsumer(false),
		};
	}

	/** Session routing delivers facts before presentation listeners observe the same event. */
	receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "object-inspection-result": {
				this.#settleFactsEntry(event.result.guid);
				const pending = this.#pendingFull.get(event.result.guid);
				if (pending === undefined) return;
				this.#pendingFull.delete(event.result.guid);
				for (const consumer of pending.consumers) consumer(event.result);
				pending.consumers.clear();
				return;
			}
			case "entity-health":
				this.#settleFactsEntry(event.health.guid);
				return;
			case "appraisal-facts-settled":
				this.#settleFactsEntry(event.guid);
				return;
			case "current-state": {
				const player = event.state.localPlayerGuid;
				if (
					event.state.lifecycle.kind !== "in-world" ||
					(this.#playerGuid !== null && player !== this.#playerGuid)
				)
					this.#reset();
				this.#playerGuid = player;
				return;
			}
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") this.#reset();
				return;
			case "resyncing":
			case "exit-requested":
				this.#reset();
		}
	}

	#settleFactsEntry(guid: number): void {
		const entry = this.#pendingFacts.get(guid);
		if (entry === undefined) return;
		this.#pendingFacts.delete(guid);
		entry.consumers.clear();
		this.#resolveSentOnce(entry);
		if (this.#activeFacts?.entry === entry) {
			this.#clearActiveFacts();
			this.#scheduleFactsFlush();
		}
	}

	#scheduleFactsFlush(): void {
		if (this.#flushScheduled) return;
		this.#flushScheduled = true;
		void Promise.resolve().then(() => {
			this.#flushScheduled = false;
			this.#flushNextFacts();
		});
	}

	#flushNextFacts(): void {
		if (this.#activeFacts !== null) return;
		let next: PendingFactsAppraisal | null = null;
		let nextPriority: FactsAppraisalPriority | null = null;

		for (const [guid, entry] of this.#pendingFacts) {
			if (entry.consumers.size === 0) {
				this.#pendingFacts.delete(guid);
				this.#resolveSentOnce(entry);
				continue;
			}
			if (entry.dispatched) continue;
			const priority = effectiveEntryPriority(entry);
			if (
				next === null ||
				nextPriority === null ||
				compareFactsPriority(priority, nextPriority) < 0 ||
				(compareFactsPriority(priority, nextPriority) === 0 &&
					(next.sequence > entry.sequence ||
						(next.sequence === entry.sequence && entry.guid < next.guid)))
			) {
				next = entry;
				nextPriority = priority;
			}
		}

		if (next === null) return;
		const entry = next;
		entry.dispatched = true;
		const watchdog = setTimeout(() => {
			if (this.#activeFacts?.entry !== entry) return;
			this.#settleFactsEntry(entry.guid);
		}, this.#factsTimeoutMs);
		this.#activeFacts = { guid: entry.guid, entry, watchdog };

		void this.#transport.sendFacts(entry.guid).then(
			() => {
				this.#resolveSentOnce(entry);
			},
			(error: unknown) => {
				this.#rejectSentOnce(entry, error);
				if (this.#pendingFacts.get(entry.guid) === entry) {
					this.#pendingFacts.delete(entry.guid);
					entry.consumers.clear();
				}
				if (this.#activeFacts?.entry === entry) {
					this.#clearActiveFacts();
					this.#scheduleFactsFlush();
				}
			},
		);
	}

	#resolveSentOnce(entry: PendingFactsAppraisal): void {
		if (entry.sentSettled) return;
		entry.sentSettled = true;
		entry.resolveSent();
	}

	#rejectSentOnce(entry: PendingFactsAppraisal, error: unknown): void {
		if (entry.sentSettled) return;
		entry.sentSettled = true;
		entry.rejectSent(error);
	}

	#clearActiveFacts(): void {
		if (this.#activeFacts === null) return;
		clearTimeout(this.#activeFacts.watchdog);
		this.#activeFacts = null;
	}

	#reset(): void {
		for (const pending of this.#pendingFull.values()) pending.consumers.clear();
		this.#pendingFull.clear();
		this.#clearActiveFacts();
		for (const pending of this.#pendingFacts.values()) {
			pending.consumers.clear();
			this.#resolveSentOnce(pending);
		}
		this.#pendingFacts.clear();
	}
}
