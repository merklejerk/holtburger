import type { PreparedAsset, PreparedAssetReader } from "../assets/contracts";
import { createResolverEnvCellPreparedAssetView } from "../assets/preparation/env-cell-views";
import { createResolverGfxObjPreparedAssetView } from "../assets/preparation/gfx-obj-views";
import { createResolverRenderSurfacePreparedAssetView } from "../assets/preparation/render-surface-views";
import type { DynamicEntityRecipe } from "./contracts";
import type {
	DynamicVisualRecipeWorkerPort,
	DynamicVisualRecipeWorkerRequestPayload,
	DynamicVisualRecipeWorkerThreadMessage,
} from "./visual-recipe-protocol";
import type {
	DynamicVisualRecipeResolutionRequest,
	DynamicVisualRecipeResolver,
} from "./visual-recipe-resolver";

interface PendingDynamicVisualRecipeRequest {
	readonly reject: (error: Error) => void;
	readonly resolve: (recipe: DynamicEntityRecipe) => void;
}

interface DynamicVisualRecipeWorkerClientOptions {
	readonly disposePort?: () => void;
}

export interface DynamicVisualRecipeMainAssetBridge {
	dispose(): void;
}

export class DynamicVisualRecipeWorkerClient implements DynamicVisualRecipeResolver {
	readonly #disposePort: (() => void) | null;
	#disposed = false;
	#nextRequestIndex = 0;
	readonly #pending = new Map<string, PendingDynamicVisualRecipeRequest>();
	readonly #port: DynamicVisualRecipeWorkerPort;
	readonly #onMessage = (
		event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(
		port: DynamicVisualRecipeWorkerPort,
		options: DynamicVisualRecipeWorkerClientOptions = {},
	) {
		this.#port = port;
		this.#disposePort = options.disposePort ?? null;
		this.#port.addEventListener("message", this.#onMessage);
	}

	resolveRecipe(
		request: DynamicVisualRecipeResolutionRequest,
	): Promise<DynamicEntityRecipe> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("Dynamic visual recipe worker client was disposed."),
			);
		}

		const requestId = `dynamic-visual-recipe:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;
		const workerRequest = createWorkerRequestPayload(request);

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				kind: "resolve-dynamic-visual-recipe",
				request: workerRequest,
				requestId,
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
			pending.reject(
				new Error("Dynamic visual recipe worker client was disposed."),
			);
		}
		this.#pending.clear();
		this.#disposePort?.();
	}

	#handleResponse(response: DynamicVisualRecipeWorkerThreadMessage): void {
		if (
			response.kind !== "dynamic-visual-recipe-resolved" &&
			response.kind !== "dynamic-visual-recipe-resolve-failed"
		) {
			return;
		}

		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "dynamic-visual-recipe-resolve-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.recipe);
	}
}

export function createDynamicVisualRecipeMainAssetBridge(
	port: DynamicVisualRecipeWorkerPort,
	assetReader: PreparedAssetReader,
): DynamicVisualRecipeMainAssetBridge {
	const onMessage = (
		event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
	): void => {
		const message = event.data;
		if (message.kind !== "prepared-asset-requested") {
			return;
		}

		void assetReader
			.requestPreparedAsset(message.key)
			.then((asset) => {
				port.postMessage({
					asset: createDynamicVisualRecipePreparedAssetView(asset),
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

function createWorkerRequestPayload(
	request: DynamicVisualRecipeResolutionRequest,
): DynamicVisualRecipeWorkerRequestPayload {
	return {
		animationSelection: request.animationSelection,
		baseTransform: request.baseTransform,
		entityId: request.entityId,
		materialPolicy: request.materialPolicy,
		modelData: request.modelData,
		setupModelId: request.setupModelId,
		source: request.source,
	};
}

function createDynamicVisualRecipePreparedAssetView(
	asset: PreparedAsset,
): PreparedAsset {
	return createResolverEnvCellPreparedAssetView(
		createResolverGfxObjPreparedAssetView(
			createResolverRenderSurfacePreparedAssetView(asset),
		),
	);
}
