import {
	decodeDynamicEntityEvent,
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	decodeExplorerCatalogCapability,
	decodeExplorerEntityMutationReceipt,
	decodeExplorerWeenieSearchRequest,
	decodeExplorerWeenieSearchResults,
	type ExplorerCatalogCapability,
	type ExplorerEntityMutationReceipt,
	type ExplorerEntityRelocationRequest,
	type ExplorerEntitySpawnRequest,
	type LaunchExplorerEntityRequest,
	type ExplorerWeenieSearchRequest,
	type ExplorerWeenieSearchResult,
} from "./explorer-entity-commands";
import {
	decodeExplorerPossession,
	decodePossessionEventOutcomes,
	decodePossessionEventQueueReceipt,
	decodePossessionIntentResult,
	decodePossessionMotionProbe,
	type ExplorerPossession,
	type ExplorerPossessionEventRequest,
	type ExplorerPossessionIntent,
	type PossessionEventQueueReceipt,
	type PossessionEventOutcome,
	type PossessionIntentResult,
	type PossessionMotionProbe,
} from "./explorer-entity-possession";
import {
	decodeExplorerFixedTickEnvelope,
	type ExplorerFixedTickEnvelope,
} from "./explorer-fixed-tick";
import type {
	HostCommandArguments,
	HostCommandName,
	HostTransport,
} from "../lib/host/host-transport";

const DYNAMIC_ENTITY_EVENT = "explorer-dynamic-entity";
const FIXED_TICK_EVENT = "explorer-fixed-tick";
const POSSESSION_EVENT_OUTCOMES = "explorer-possession-event-outcomes";

/** One atomic host envelope paired with the single browser receipt instant both consumers use. */
export interface ExplorerFixedTickReceipt {
	readonly envelope: ExplorerFixedTickEnvelope;
	readonly receivedAtMs: number;
}

/** Injectable host boundary for listener-before-request hydration and focused commands. */
export interface ExplorerDynamicEntityTransport {
	listen(
		event:
			| typeof DYNAMIC_ENTITY_EVENT
			| typeof FIXED_TICK_EVENT
			| typeof POSSESSION_EVENT_OUTCOMES,
		handler: (payload: unknown) => void,
	): Promise<() => void>;
	invoke(
		command: HostCommandName,
		args?: HostCommandArguments,
	): Promise<unknown>;
}

/** Owns one frontend listener lifetime over a shared current-entity mirror. */
export class ExplorerDynamicEntitySession {
	readonly mirror: DynamicEntityMirror;
	readonly #transport: ExplorerDynamicEntityTransport;
	readonly #listeners = new Set<(event: DynamicEntityEvent) => void>();
	readonly #fixedTickListeners = new Set<
		(receipt: ExplorerFixedTickReceipt) => void
	>();
	readonly #possessionOutcomeListeners = new Set<
		(outcome: PossessionEventOutcome) => void
	>();
	readonly #waiters = new Set<{
		readonly reached: () => boolean;
		readonly resolve: () => void;
		readonly reject: (reason: Error) => void;
	}>();
	#unlisten: readonly (() => void)[] | null = null;
	#acceptedRevision = 0;
	#highestFixedTickEpoch = 0;
	readonly #now: () => number;

	constructor(
		transport: ExplorerDynamicEntityTransport,
		mirror = new DynamicEntityMirror(),
		now = () => performance.now(),
	) {
		this.#transport = transport;
		this.mirror = mirror;
		this.#now = now;
	}

	/** Register the listener first, then request the complete current snapshot. */
	async start(): Promise<void> {
		if (this.#unlisten !== null) return;
		this.mirror.awaitSnapshot();
		const unlistenDynamic = await this.#transport.listen(
			DYNAMIC_ENTITY_EVENT,
			(payload) => this.#receive(payload),
		);
		let unlistenFixed: (() => void) | null = null;
		let unlistenPossession: (() => void) | null = null;
		try {
			unlistenFixed = await this.#transport.listen(
				FIXED_TICK_EVENT,
				(payload) => this.#receiveFixedTick(payload),
			);
			unlistenPossession = await this.#transport.listen(
				POSSESSION_EVENT_OUTCOMES,
				(payload) => this.#receivePossessionOutcomes(payload),
			);
			this.#unlisten = [unlistenDynamic, unlistenFixed, unlistenPossession];
			await this.#transport.invoke("request_explorer_dynamic_entity_snapshot");
		} catch (error) {
			this.#unlisten = null;
			unlistenPossession?.();
			unlistenFixed?.();
			unlistenDynamic();
			throw error;
		}
	}

	/** Stop receiving live mutations; a later start requires a replacement snapshot. */
	stop(): void {
		for (const unlisten of this.#unlisten ?? []) unlisten();
		this.#unlisten = null;
		this.#highestFixedTickEpoch = 0;
		this.mirror.awaitSnapshot();
		for (const waiter of this.#waiters) {
			waiter.reject(
				new Error("Dynamic-entity session stopped before command publication."),
			);
		}
		this.#waiters.clear();
	}

	/** Read the immutable optional catalog capability selected by the host at composition. */
	async catalogCapability(): Promise<ExplorerCatalogCapability> {
		return decodeExplorerCatalogCapability(
			await this.#transport.invoke("explorer_catalog_capability"),
		);
	}

	/** Search the host-owned catalog index and validate its bounded ordered identities. */
	async searchWeenies(
		request: ExplorerWeenieSearchRequest,
	): Promise<readonly ExplorerWeenieSearchResult[]> {
		const validatedRequest = decodeExplorerWeenieSearchRequest(request);
		return decodeExplorerWeenieSearchResults(
			await this.#transport.invoke("search_explorer_weenies", {
				request: validatedRequest,
			}),
		);
	}

	/** Spawn one explicit catalog-backed candidate and validate its committed identity. */
	async spawn(
		request: ExplorerEntitySpawnRequest,
	): Promise<ExplorerEntityMutationReceipt> {
		const afterRevision = this.#acceptedRevision;
		const receipt = decodeExplorerEntityMutationReceipt(
			await this.#transport.invoke("spawn_explorer_entity", { request }),
		);
		await this.#waitForCurrent(receipt, true, afterRevision);
		return receipt;
	}

	/** Despawn one exact live generation and validate the retired identity. */
	async despawn(
		guid: number,
		generation: number,
	): Promise<ExplorerEntityMutationReceipt> {
		const afterRevision = this.#acceptedRevision;
		const receipt = decodeExplorerEntityMutationReceipt(
			await this.#transport.invoke("despawn_explorer_entity", {
				guid,
				generation,
			}),
		);
		await this.#waitForCurrent(receipt, false, afterRevision);
		return receipt;
	}

	/** Launch one exact physical generation and await its complete upsert. */
	async launch(
		request: LaunchExplorerEntityRequest,
	): Promise<ExplorerEntityMutationReceipt> {
		const afterRevision = this.#acceptedRevision;
		const receipt = decodeExplorerEntityMutationReceipt(
			await this.#transport.invoke("launch_explorer_entity", { request }),
		);
		await this.#waitForCurrent(receipt, true, afterRevision);
		return receipt;
	}

	/** Apply one exact teleport/reset and await its correction batch. */
	async relocate(
		request: ExplorerEntityRelocationRequest,
	): Promise<ExplorerEntityMutationReceipt> {
		const afterRevision = this.#acceptedRevision;
		const receipt = decodeExplorerEntityMutationReceipt(
			await this.#transport.invoke("relocate_explorer_entity", { request }),
		);
		await this.#waitForCurrent(receipt, true, afterRevision);
		return receipt;
	}

	/**
	 * Possess one spawned entity so commands reach it, or release with `null`.
	 *
	 * Possession is not a registry mutation, so it publishes no snapshot and is not awaited against
	 * one: the entity is unchanged, only who is driving it.
	 */
	async possess(guid: number | null): Promise<ExplorerPossession> {
		return decodeExplorerPossession(
			await this.#transport.invoke("possess_explorer_entity", {
				request: { guid },
			}),
		);
	}

	/** Replace one coalescible semantic snapshot for an exact possession epoch. */
	async setPossessionIntent(
		request: ExplorerPossessionIntent,
	): Promise<PossessionIntentResult> {
		return decodePossessionIntentResult(
			await this.#transport.invoke("set_explorer_possession_intent", {
				request,
			}),
		);
	}

	/** Queue one non-coalescible lifecycle edge for fixed-tick application. */
	async queuePossessionEvent(
		request: ExplorerPossessionEventRequest,
	): Promise<PossessionEventQueueReceipt> {
		return decodePossessionEventQueueReceipt(
			await this.#transport.invoke("queue_explorer_possession_event", {
				request,
			}),
		);
	}

	/** Read the host-applied possession playback and physical status for sampled diagnostics. */
	async possessionMotionProbe(): Promise<PossessionMotionProbe | null> {
		return decodePossessionMotionProbe(
			await this.#transport.invoke("explorer_possession_motion_probe"),
		);
	}

	/** Observe accepted current-state changes without creating another entity authority. */
	subscribe(listener: (event: DynamicEntityEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Observe integrated entity and boom paths with one browser playback origin. */
	subscribeFixedTicks(
		listener: (receipt: ExplorerFixedTickReceipt) => void,
	): () => void {
		this.#fixedTickListeners.add(listener);
		return () => this.#fixedTickListeners.delete(listener);
	}

	/** Observe fixed-tick lifecycle outcomes for the active possession generation. */
	subscribePossessionOutcomes(
		listener: (outcome: PossessionEventOutcome) => void,
	): () => void {
		this.#possessionOutcomeListeners.add(listener);
		return () => this.#possessionOutcomeListeners.delete(listener);
	}

	#receive(payload: unknown): void {
		const event = decodeDynamicEntityEvent(payload);
		if (!this.mirror.apply(event)) return;
		this.#acceptedRevision += 1;
		for (const listener of this.#listeners) listener(event);
		for (const waiter of [...this.#waiters]) {
			if (!waiter.reached()) continue;
			this.#waiters.delete(waiter);
			waiter.resolve();
		}
	}

	#receivePossessionOutcomes(payload: unknown): void {
		for (const outcome of decodePossessionEventOutcomes(payload)) {
			for (const listener of this.#possessionOutcomeListeners)
				listener(outcome);
		}
	}

	#receiveFixedTick(payload: unknown): void {
		const envelope = decodeExplorerFixedTickEnvelope(payload);
		if (
			envelope.epoch <= this.#highestFixedTickEpoch ||
			this.mirror.isAwaitingSnapshot()
		) {
			return;
		}
		this.#highestFixedTickEpoch = envelope.epoch;
		if (
			envelope.entityEvent !== null &&
			this.mirror.apply(envelope.entityEvent)
		) {
			this.#acceptedRevision += 1;
		}
		const receipt = { envelope, receivedAtMs: this.#now() };
		for (const listener of this.#fixedTickListeners) listener(receipt);
	}

	/** Pair command completion with the focused event the host publishes before returning. */
	async #waitForCurrent(
		receipt: ExplorerEntityMutationReceipt,
		present: boolean,
		afterRevision: number,
	): Promise<void> {
		const reached = (): boolean => {
			if (this.#acceptedRevision <= afterRevision) return false;
			const current = this.mirror
				.entities()
				.find((entity) => entity.identity.guid === receipt.guid);
			return present
				? current?.generation === receipt.generation
				: current === undefined;
		};
		if (reached()) return;
		await new Promise<void>((resolve, reject) => {
			this.#waiters.add({
				reached,
				reject: (reason) => reject(reason),
				resolve,
			});
		});
	}
}

/** Host-backed transport keeps browser-only harnesses independent from any desktop shell. */
export function hostExplorerDynamicEntityTransport(
	host: HostTransport,
): ExplorerDynamicEntityTransport {
	return {
		listen: (event, handler) => host.listen(event, handler),
		invoke: (command, args) => host.invoke(command, args),
	};
}
