import {
	decodeDynamicEntityEvent,
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "./dynamic-entity-feed";

/**
 * The two operations required to hydrate one source-neutral dynamic-entity mirror.
 *
 * The session deliberately accepts functions rather than a host transport. Explorer and client
 * authorities can therefore project their own event names and request envelopes without making
 * the shared mirror know which producer is authoritative.
 */
export interface DynamicEntitySessionDependencies {
	/** Subscribe to the authority's dynamic feed and return its lifetime disposer. */
	subscribe(handler: (payload: unknown) => void): Promise<() => void>;
	/** Request one complete replacement snapshot after the feed listener is installed. */
	requestCurrentState(): Promise<void>;
}

/** Optional work that an authority needs to install beside the dynamic-feed listener. */
export interface DynamicEntitySessionStartOptions {
	/** Install any additional authority listeners before the snapshot request is sent. */
	beforeRequest?(): void | Promise<void>;
}

/**
 * Owns one dynamic-feed listener and the replacement-snapshot boundary around it.
 *
 * A snapshot is requested only after the listener is live. Calling {@link invalidate} (including
 * through {@link stop}) drops all deltas until that replacement arrives, so a lost broadcast cannot
 * leave a plausible-looking but incomplete mirror behind.
 */
export class DynamicEntitySession {
	readonly mirror: DynamicEntityMirror;
	readonly #dependencies: DynamicEntitySessionDependencies;
	readonly #listeners = new Set<(event: DynamicEntityEvent) => void>();
	#unlisten: (() => void) | null = null;

	constructor(
		dependencies: DynamicEntitySessionDependencies,
		mirror = new DynamicEntityMirror(),
	) {
		this.#dependencies = dependencies;
		this.mirror = mirror;
	}

	/** Register the feed first, install any sibling listeners, then request replacement state. */
	async start(options: DynamicEntitySessionStartOptions = {}): Promise<void> {
		if (this.#unlisten !== null) return;
		this.invalidate();
		const unlisten = await this.#dependencies.subscribe((payload) =>
			this.#receive(payload),
		);
		try {
			await options.beforeRequest?.();
			this.#unlisten = unlisten;
			await this.#dependencies.requestCurrentState();
		} catch (error) {
			unlisten();
			this.#unlisten = null;
			this.invalidate();
			throw error;
		}
	}

	/** Stop receiving deltas and require a replacement snapshot on the next start. */
	stop(): void {
		this.#unlisten?.();
		this.#unlisten = null;
		this.invalidate();
	}

	/** Declare the current feed incomplete; only a replacement snapshot can make it current again. */
	invalidate(): void {
		this.mirror.awaitSnapshot();
	}

	/** Observe accepted events without creating another entity authority. */
	subscribe(listener: (event: DynamicEntityEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#receive(payload: unknown): void {
		const event = decodeDynamicEntityEvent(payload);
		if (!this.mirror.apply(event)) return;
		for (const listener of this.#listeners) listener(event);
	}
}
