import {
	decodeDynamicEntityEvent,
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";

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
	#unlisten: (() => void) | null = null;

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
	}

	/** Invoke one typed-by-caller Explorer host operation over the same Tauri transport. */
	invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
		return this.#transport.invoke(command, args);
	}

	#receive(payload: unknown): void {
		this.mirror.apply(decodeDynamicEntityEvent(payload));
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
