/// <reference lib="webworker" />

import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { describeHostAssetKey } from "../assets/keys";
import {
	type DynamicVisualRecipePreparedAssetResponse,
	type DynamicVisualRecipeWorkerGlobalPort,
	type DynamicVisualRecipeWorkerMainMessage,
} from "./visual-recipe-protocol";
import { handleDynamicVisualRecipeWorkerRequest } from "./visual-recipe-worker-handler";

interface PendingWorkerPreparedAssetRequest {
	readonly reject: (error: Error) => void;
	readonly resolve: (asset: PreparedAsset) => void;
}

class DynamicVisualRecipeWorkerPreparedAssetReader implements PreparedAssetReader {
	#nextRequestIndex = 1;
	readonly #onMessage = (
		event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>,
	): void => {
		this.#handleResponse(event.data);
	};
	readonly #pending = new Map<string, PendingWorkerPreparedAssetRequest>();
	readonly #port: DynamicVisualRecipeWorkerGlobalPort;

	constructor(port: DynamicVisualRecipeWorkerGlobalPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const requestId = `dynamic-visual-recipe-asset-${this.#nextRequestIndex++}`;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				key,
				kind: "prepared-asset-requested",
				requestId,
			});
		});
	}

	#handleResponse(
		response:
			| DynamicVisualRecipePreparedAssetResponse
			| DynamicVisualRecipeWorkerMainMessage,
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
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.asset);
	}
}

class RequestScopedPreparedAssetReader implements PreparedAssetReader {
	readonly #pending = new Map<string, Promise<PreparedAsset>>();
	readonly #reader: PreparedAssetReader;

	constructor(reader: PreparedAssetReader) {
		this.#reader = reader;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const cacheKey = describeHostAssetKey(key);
		const pending = this.#pending.get(cacheKey);
		if (pending) {
			return pending;
		}

		const next = this.#reader.requestPreparedAsset(key).finally(() => {
			this.#pending.delete(cacheKey);
		});
		this.#pending.set(cacheKey, next);
		return next;
	}
}

const workerPort = self as unknown as DynamicVisualRecipeWorkerGlobalPort;
const workerAssetReader = new DynamicVisualRecipeWorkerPreparedAssetReader(
	workerPort,
);

workerPort.addEventListener(
	"message",
	(event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>) => {
		void handleDynamicVisualRecipeWorkerRequest(
			new RequestScopedPreparedAssetReader(workerAssetReader),
			event.data,
			(response) => workerPort.postMessage(response),
		);
	},
);
