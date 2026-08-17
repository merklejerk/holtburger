import {
	decodeDynamicEntityEvent,
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	decodeExplorerCatalogCapability,
	decodeExplorerEntityMutationReceipt,
	type ExplorerCatalogCapability,
	type ExplorerEntityMutationReceipt,
	type ExplorerEntityRelocationRequest,
	type ExplorerEntitySpawnRequest,
	type LaunchExplorerEntityRequest,
} from "./explorer-entity-commands";

const DYNAMIC_ENTITY_EVENT = "explorer-dynamic-entity";

/** Injectable Tauri boundary for listener-before-request recovery and focused commands. */
export interface ExplorerDynamicEntityTransport {
	listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void>;
	invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Owns one frontend listener lifetime over a shared current-entity mirror. */
export class ExplorerDynamicEntitySession {
	readonly mirror: DynamicEntityMirror;
	readonly #transport: ExplorerDynamicEntityTransport;
	readonly #listeners = new Set<(event: DynamicEntityEvent) => void>();
	readonly #waiters = new Set<{
		readonly reached: () => boolean;
		readonly resolve: () => void;
		readonly reject: (reason: Error) => void;
	}>();
	#unlisten: (() => void) | null = null;
	#acceptedRevision = 0;

	constructor(
		transport: ExplorerDynamicEntityTransport,
		mirror = new DynamicEntityMirror(),
	) {
		this.#transport = transport;
		this.mirror = mirror;
	}

	/** Register the listener first, then request the complete current snapshot. */
	async start(): Promise<void> {
		if (this.#unlisten !== null) return;
		this.mirror.awaitSnapshot();
		const unlisten = await this.#transport.listen(
			DYNAMIC_ENTITY_EVENT,
			(payload) => this.#receive(payload),
		);
		this.#unlisten = unlisten;
		try {
			await this.#transport.invoke("request_explorer_dynamic_entity_snapshot");
		} catch (error) {
			this.#unlisten = null;
			unlisten();
			throw error;
		}
	}

	/** Stop receiving live mutations; a later start requires a replacement snapshot. */
	stop(): void {
		this.#unlisten?.();
		this.#unlisten = null;
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

	/** Observe accepted current-state changes without creating another entity authority. */
	subscribe(listener: (event: DynamicEntityEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
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

/** Production dynamic import keeps browser-only harnesses independent from Tauri. */
export function tauriExplorerDynamicEntityTransport(): ExplorerDynamicEntityTransport {
	return {
		listen: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<DynamicEntityEvent>(event, ({ payload }) =>
				handler(payload),
			);
		},
		invoke: async (command, args) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return invoke(command, args);
		},
	};
}
