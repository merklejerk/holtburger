import type {
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolverJob,
	StaticResolver,
	StaticScopePayload,
} from "../contracts";
import type {
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";

interface PendingResolverRequest {
	readonly resolve: (payload: unknown) => void;
	readonly reject: (error: Error) => void;
}

interface StaticResolverWorkerClientOptions {
	readonly disposePort?: () => void;
}

export class StaticResolverWorkerClient
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #port: StaticResolverWorkerPort;
	readonly #disposePort: (() => void) | null;
	readonly #pending = new Map<string, PendingResolverRequest>();
	#nextRequestIndex = 0;
	#disposed = false;
	readonly #onMessage = (
		event: MessageEvent<StaticResolverWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(
		port: StaticResolverWorkerPort,
		options: StaticResolverWorkerClientOptions = {},
	) {
		this.#port = port;
		this.#disposePort = options.disposePort ?? null;
		this.#port.addEventListener("message", this.#onMessage);
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("Static resolver worker client was disposed."),
			);
		}

		const requestId = `resolver-job:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, {
				reject,
				resolve: (payload) => resolve(payload as StaticScopePayload),
			});
			this.#port.postMessage({
				job,
				kind: "resolve-static-scope",
				requestId,
			});
		});
	}

	resolveSource(
		sourceRequest: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("Static resolver worker client was disposed."),
			);
		}

		const requestId = `resolver-source:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, {
				reject,
				resolve: (payload) =>
					resolve(payload as StaticLandblockSceneLodResolution),
			});
			this.#port.postMessage({
				kind: "resolve-landblock-scene-lod-source",
				requestId,
				sourceRequest,
			});
		});
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static resolver worker client was disposed."));
		}
		this.#pending.clear();
		this.#disposePort?.();
	}

	#handleResponse(response: StaticResolverWorkerThreadMessage): void {
		if (
			response.kind !== "static-scope-resolved" &&
			response.kind !== "landblock-scene-lod-source-resolved" &&
			response.kind !== "static-scope-resolve-failed"
		) {
			return;
		}

		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "static-scope-resolve-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(
			response.kind === "static-scope-resolved"
				? response.payload
				: response.resolution,
		);
	}
}

export class WorkerPoolStaticResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #resolvers: readonly (StaticResolver &
		Partial<StaticLandblockSceneLodSourceResolver>)[];
	#nextResolverIndex = 0;
	#disposed = false;

	constructor(
		resolvers: readonly (StaticResolver &
			Partial<StaticLandblockSceneLodSourceResolver>)[],
	) {
		if (resolvers.length === 0) {
			throw new Error(
				"WorkerPoolStaticResolver requires at least one resolver.",
			);
		}

		this.#resolvers = resolvers;
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolStaticResolver has been disposed."),
			);
		}

		const resolver = this.#resolvers[this.#nextResolverIndex];
		if (!resolver) {
			return Promise.reject(
				new Error("WorkerPoolStaticResolver has no active resolver."),
			);
		}

		this.#nextResolverIndex =
			(this.#nextResolverIndex + 1) % this.#resolvers.length;

		return resolver.resolve(job);
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolStaticResolver has been disposed."),
			);
		}

		const resolver = this.#resolvers[this.#nextResolverIndex];
		if (!resolver) {
			return Promise.reject(
				new Error("WorkerPoolStaticResolver has no active resolver."),
			);
		}
		if (!resolver.resolveSource) {
			return Promise.reject(
				new Error(
					"WorkerPoolStaticResolver source resolution requires source-capable workers.",
				),
			);
		}

		this.#nextResolverIndex =
			(this.#nextResolverIndex + 1) % this.#resolvers.length;

		return resolver.resolveSource(request);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		for (const resolver of this.#resolvers) {
			disposeIfAvailable(resolver);
		}
	}
}

function disposeIfAvailable(value: unknown): void {
	if (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	) {
		value.dispose();
	}
}
