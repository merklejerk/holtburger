import { abortError, awaitWithAbort } from "../../async-lifetime";
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
	/** Optional owning startup lifetime; cancellation cannot install a late feed listener. */
	readonly signal?: AbortSignal;
	/** Install any additional authority listeners before the snapshot request is sent. */
	beforeRequest?(): void | Promise<void>;
}

/** One subscription attempt retains its disposer even while sibling startup is pending. */
interface FeedAttachment {
	readonly lifetime: AbortController;
	readonly signal: AbortSignal;
	readonly completion: Promise<void>;
	unlisten: (() => void) | null;
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
	#attachment: FeedAttachment | null = null;

	constructor(
		dependencies: DynamicEntitySessionDependencies,
		mirror = new DynamicEntityMirror(),
	) {
		this.#dependencies = dependencies;
		this.mirror = mirror;
	}

	/** Register the feed first, install any sibling listeners, then request replacement state. */
	start(options: DynamicEntitySessionStartOptions = {}): Promise<void> {
		if (this.#attachment !== null) return this.#attachment.completion;
		this.invalidate();
		const lifetime = new AbortController();
		const attachment: FeedAttachment = {
			lifetime,
			signal:
				options.signal === undefined
					? lifetime.signal
					: AbortSignal.any([lifetime.signal, options.signal]),
			unlisten: null,
			completion: Promise.resolve().then(() =>
				this.#attach(attachment, options),
			),
		};
		this.#attachment = attachment;
		return attachment.completion;
	}
	async #attach(
		attachment: FeedAttachment,
		options: DynamicEntitySessionStartOptions,
	): Promise<void> {
		const signal = attachment.signal;
		try {
			signal.throwIfAborted();
			const installing = this.#dependencies
				.subscribe((payload) => {
					if (!signal.aborted) this.#receive(payload);
				})
				.then((unlisten) => {
					if (signal.aborted) {
						unlisten();
						throw signal.reason;
					}
					attachment.unlisten = unlisten;
				});
			await awaitWithAbort(installing, signal);
			signal.throwIfAborted();
			await awaitWithAbort(Promise.resolve(options.beforeRequest?.()), signal);
			signal.throwIfAborted();
			await awaitWithAbort(this.#dependencies.requestCurrentState(), signal);
		} catch (error) {
			this.#release(attachment);
			if (this.#attachment === attachment) {
				this.#attachment = null;
				this.invalidate();
			}
			throw error;
		}
	}
	#release(attachment: FeedAttachment): void {
		attachment.unlisten?.();
		attachment.unlisten = null;
	}
	/** Stop receiving deltas and invalidate an installer that has not returned its disposer yet. */
	stop(): void {
		const attachment = this.#attachment;
		this.#attachment = null;
		if (attachment !== null) {
			attachment.lifetime.abort(abortError("Dynamic feed retired."));
			this.#release(attachment);
		}
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
