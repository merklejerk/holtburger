import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetPriority,
	FrontendStateFeedDto,
	RuntimeBatchDto,
} from "../host/contracts";
import { lookupAsset } from "../host/tauri";
import type { PreparedAssetRecord } from "./types";
import type {
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";

export interface AssetWorkerLike {
	onmessage:
		| ((event: MessageEvent<AssetWorkerResponseMessage>) => void)
		| null;
	onerror: ((event: Event | ErrorEvent) => void) | null;
	postMessage(message: AssetWorkerRequestMessage): void;
	terminate(): void;
}

type AssetLookupFn = (
	request: AssetLookupRequestDto,
) => Promise<AssetLookupResponseDto>;

type PendingAssetRequest = {
	resolve: (asset: PreparedAssetRecord) => void;
	reject: (error: Error) => void;
};

export class AssetChannelController {
	private readonly worker: AssetWorkerLike;

	private readonly pendingRequests = new Map<string, PendingAssetRequest>();

	constructor(
		private readonly lookupAssetFn: AssetLookupFn = lookupAsset,
		workerFactory: () => AssetWorkerLike = createAssetWorker,
	) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const message = event.data;
			if (message.type === "asset-ready") {
				const pending = this.pendingRequests.get(message.asset.request.requestId);
				if (!pending) {
					return;
				}

				this.pendingRequests.delete(message.asset.request.requestId);
				pending.resolve(message.asset);
				return;
			}

			const pending = this.pendingRequests.get(message.requestId);
			if (!pending) {
				return;
			}

			this.pendingRequests.delete(message.requestId);
			pending.reject(new Error(message.message));
		};
		this.worker.onerror = (event) => {
			const errorMessage =
				event instanceof ErrorEvent
					? event.message
					: "Asset worker failed before preparation completed.";
			const error = new Error(errorMessage);
			for (const pending of this.pendingRequests.values()) {
				pending.reject(error);
			}
			this.pendingRequests.clear();
		};
	}

	async prepareAsset(
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		const response = await this.lookupAssetFn(request);

		return new Promise<PreparedAssetRecord>((resolve, reject) => {
			this.pendingRequests.set(request.requestId, { resolve, reject });
			this.worker.postMessage({
				type: "prepare-asset",
				request,
				response,
			});
		});
	}

	dispose(): void {
		this.worker.terminate();
		const error = new Error("Asset channel was disposed before preparation completed.");
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}

export function createFocusedAssetRequest(
	runtimeBatch: RuntimeBatchDto | null,
	viewModelFeed: FrontendStateFeedDto | null,
	priority: AssetPriority,
): AssetLookupRequestDto | null {
	if (!runtimeBatch) {
		return null;
	}

	const focusEntity = selectFocusedAssetEntity(runtimeBatch, viewModelFeed, priority);

	if (!focusEntity) {
		return null;
	}

	return {
		requestId: `${priority}-${runtimeBatch.tick}-${focusEntity.appearanceId}`,
		assetId: focusEntity.appearanceId,
		priority,
	};
}

function selectFocusedAssetEntity(
	runtimeBatch: RuntimeBatchDto,
	viewModelFeed: FrontendStateFeedDto | null,
	priority: AssetPriority,
) {
	if (priority === "streaming") {
		const selectedEntity = runtimeBatch.entities.find(
			(entity) => entity.entityId === viewModelFeed?.selectedEntityId,
		);
		if (selectedEntity) {
			return selectedEntity;
		}

		const nonLocalEntity = runtimeBatch.entities.find(
			(entity) => !entity.isLocalPlayer,
		);
		if (nonLocalEntity) {
			return nonLocalEntity;
		}
	}

	return (
		runtimeBatch.entities.find((entity) => entity.isLocalPlayer) ??
		runtimeBatch.entities[0]
	);
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}