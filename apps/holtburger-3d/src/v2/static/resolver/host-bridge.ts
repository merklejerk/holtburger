import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../../host/contracts";
import type {
	StaticResolverPreparedAssetResponse,
	StaticResolverWorkerGlobalPort,
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";

interface PendingWorkerHostLookup {
	readonly resolve: (asset: PreparedAsset) => void;
	readonly reject: (error: Error) => void;
}

export class StaticResolverWorkerRuntimeHost implements RuntimeHost {
	readonly #port: StaticResolverWorkerGlobalPort;
	readonly #pending = new Map<string, PendingWorkerHostLookup>();
	readonly #onMessage = (
		event: MessageEvent<StaticResolverWorkerMainMessage>,
	): void => {
		this.#handleResponse(event.data);
	};
	#nextRequestIndex = 1;
	#lastFailure: string | null = null;

	constructor(port: StaticResolverWorkerGlobalPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	lookupAsset(
		key: Parameters<RuntimeHost["lookupAsset"]>[0],
	): Promise<PreparedAsset> {
		const requestId = `resolver-host-${this.#nextRequestIndex++}`;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				key,
				kind: "prepared-asset-requested",
				requestId,
			});
		});
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: this.#lastFailure,
			isAvailable: true,
		};
	}

	dispose(): void {
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static resolver worker host was disposed."));
		}
		this.#pending.clear();
	}

	#handleResponse(
		response:
			| StaticResolverPreparedAssetResponse
			| StaticResolverWorkerMainMessage,
	): void {
		if (
			response.kind !== "prepared-asset-request-resolved" &&
			response.kind !== "prepared-asset-request-failed"
		) {
			return;
		}

		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "prepared-asset-request-failed") {
			this.#lastFailure = response.message;
			pending.reject(new Error(response.message));
			return;
		}

		this.#lastFailure = null;
		pending.resolve(response.asset);
	}
}

export interface StaticResolverMainHostBridge {
	dispose(): void;
}

export function createStaticResolverMainHostBridge(
	port: StaticResolverWorkerPort,
	assetReader: PreparedAssetReader,
): StaticResolverMainHostBridge {
	const onMessage = (
		event: MessageEvent<StaticResolverWorkerThreadMessage>,
	): void => {
		const message = event.data;
		if (message.kind !== "prepared-asset-requested") {
			return;
		}

		void assetReader
			.requestPreparedAsset(message.key)
			.then((asset) => {
				port.postMessage({
					asset,
					kind: "prepared-asset-request-resolved",
					requestId: message.requestId,
				});
			})
			.catch((error: unknown) => {
				port.postMessage({
					kind: "prepared-asset-request-failed",
					message: error instanceof Error ? error.message : String(error),
					requestId: message.requestId,
				});
			});
	};

	port.addEventListener("message", onMessage);

	return {
		dispose: () => {
			port.removeEventListener("message", onMessage);
		},
	};
}
