import type { DynamicEntityView } from "../game/runtime/dynamic-entity-feed";
import { decodeDynamicEntityVisual } from "./decode-dynamic-entity-visual";
import type { DecodedStaticPresentation } from "./decode-static-source-record";
import type { DynamicEntityVisualSource } from "./dynamic-entity-visual-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Keep a large replacement snapshot below the sidecar's 256 pending-request ceiling. */
export const MAX_DYNAMIC_ENTITY_VISUAL_REQUESTS = 32;

interface PendingVisualRequest<T> {
	readonly operation: () => Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
}

/** Bounded content-request owner used by snapshots with hundreds of unique visuals. */
export class DynamicEntityVisualRequestGate {
	readonly #maxConcurrent: number;
	readonly #pending: PendingVisualRequest<unknown>[] = [];
	#active = 0;
	#peakActive = 0;
	#destroyed = false;

	constructor(maxConcurrent = MAX_DYNAMIC_ENTITY_VISUAL_REQUESTS) {
		if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
			throw new Error("Dynamic entity visual concurrency must be positive.");
		}
		this.#maxConcurrent = maxConcurrent;
	}

	get activeCount(): number {
		return this.#active;
	}

	get peakActiveCount(): number {
		return this.#peakActive;
	}

	schedule<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#destroyed) {
			return Promise.reject(
				new Error("Dynamic entity visual requests are stopped."),
			);
		}
		return new Promise<T>((resolve, reject) => {
			this.#pending.push({
				operation,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.#drain();
		});
	}

	/** Reject queued operations; in-flight host calls are allowed to settle naturally. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const error = new Error("Dynamic entity visual requests are stopped.");
		for (const request of this.#pending.splice(0)) request.reject(error);
	}

	#drain(): void {
		while (!this.#destroyed && this.#active < this.#maxConcurrent) {
			const request = this.#pending.shift();
			if (request === undefined) return;
			this.#active += 1;
			this.#peakActive = Math.max(this.#peakActive, this.#active);
			void Promise.resolve()
				.then(request.operation)
				.then(request.resolve, request.reject)
				.finally(() => {
					this.#active -= 1;
					this.#drain();
				});
		}
	}
}

/** Loads one exact source-neutral entity appearance from the app-local content host. */
export class DynamicEntityVisualHostSource implements DynamicEntityVisualSource {
	readonly #transport: HostTransport;
	readonly #requests = new DynamicEntityVisualRequestGate();

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	async load(
		presentation: DynamicEntityView["presentation"],
	): Promise<DecodedStaticPresentation> {
		return this.#requests.schedule(async () => {
			const response = await this.#transport.invoke(
				"load_dynamic_entity_visual",
				{
					request: {
						appearance: presentation.appearance,
						setupDid: presentation.content.setupDid,
					},
				},
			);
			return decodeDynamicEntityVisual(
				asHostBinary(response, "Dynamic-entity visual host command"),
			);
		});
	}

	destroy(): void {
		this.#requests.destroy();
	}
}
