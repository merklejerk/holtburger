import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../host/contracts";
import { lookupAsset } from "../host/tauri";
import {
	AssetGraphScheduler,
	type AssetGraphPreparationResult,
} from "./asset-graph-scheduler";
import { getAssetResponseDependencies } from "./dependencies";
import type { PreparedAssetRecord } from "./types";
import type {
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";

export interface AssetWorkerLike {
	onmessage: ((event: MessageEvent<AssetWorkerResponseMessage>) => void) | null;
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

interface AssetLoadEntry {
	responseRequestId: string | null;
	responsePromise: Promise<LookedUpAssetResponse> | null;
	responseReject: ((error: Error) => void) | null;
	preparedRequestId: string | null;
	preparedPromise: Promise<PreparedAssetRecord> | null;
}

export interface LookedUpAssetResponse {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	dependencyAssetIds: string[];
}

export interface AssetPreparationGateway {
	lookupAssetResponse(
		request: AssetLookupRequestDto,
	): Promise<LookedUpAssetResponse>;
	prepareLookedUpAsset(
		lookedUp: LookedUpAssetResponse,
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord>;
}

export class AssetChannelController {
	private readonly worker: AssetWorkerLike;

	private readonly pendingRequests = new Map<string, PendingAssetRequest>();

	private readonly loadEntriesByAssetId = new Map<string, AssetLoadEntry>();

	private disposed = false;

	constructor(
		private readonly lookupAssetFn: AssetLookupFn = lookupAsset,
		workerFactory: () => AssetWorkerLike = createAssetWorker,
	) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const message = event.data;
			if (message.type === "asset-ready") {
				const pending = this.pendingRequests.get(
					message.asset.request.requestId,
				);
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
		const lookedUp = await this.lookupAssetResponse(request);
		return this.prepareLookedUpAsset(lookedUp, request);
	}

	async lookupAssetResponse(
		request: AssetLookupRequestDto,
	): Promise<LookedUpAssetResponse> {
		this.throwIfDisposed();

		const entry = this.getOrCreateLoadEntry(request.assetId);
		if (entry.responsePromise) {
			return rebindLookedUpAssetResponse(await entry.responsePromise, request);
		}

		entry.responseRequestId = request.requestId;
		entry.responsePromise = new Promise<LookedUpAssetResponse>(
			(resolve, reject) => {
				entry.responseReject = reject;
				void (async () => {
					try {
						const response = await this.lookupAssetFn(request);
						this.throwIfDisposed();
						const reboundResponse = rebindAssetLookupResponse(
							response,
							request,
						);
						resolve({
							request,
							response: reboundResponse,
							dependencyAssetIds: getAssetResponseDependencies(
								reboundResponse,
							).map((dependency) => dependency.assetId),
						});
					} catch (error) {
						reject(toError(error));
					}
				})();
			},
		);

		try {
			return await entry.responsePromise;
		} catch (error) {
			this.clearResponseLoadEntry(request.assetId, request.requestId);
			throw error;
		} finally {
			queueMicrotask(() => {
				const active = this.loadEntriesByAssetId.get(request.assetId);
				if (
					active?.responseRequestId === request.requestId &&
					!active.preparedPromise
				) {
					this.clearResponseLoadEntry(request.assetId, request.requestId);
				}
			});
		}
	}

	async prepareLookedUpAsset(
		lookedUp: LookedUpAssetResponse,
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		this.throwIfDisposed();

		const entry = this.getOrCreateLoadEntry(request.assetId);
		if (entry.preparedPromise) {
			return rebindPreparedAssetRequest(await entry.preparedPromise, request);
		}

		entry.preparedRequestId = request.requestId;
		entry.preparedPromise = new Promise<PreparedAssetRecord>(
			(resolve, reject) => {
				this.pendingRequests.set(request.requestId, { resolve, reject });
				try {
					this.worker.postMessage({
						type: "prepare-asset",
						request,
						response: rebindAssetLookupResponse(lookedUp.response, request),
					});
				} catch (error) {
					this.pendingRequests.delete(request.requestId);
					reject(toError(error));
				}
			},
		);

		try {
			return await entry.preparedPromise;
		} finally {
			this.clearPreparedLoadEntry(request.assetId, request.requestId);
		}
	}

	async prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedByAssetId: Record<string, PreparedAssetRecord> = {},
	): Promise<AssetGraphPreparationResult> {
		return new AssetGraphScheduler(this).prepareAssetGraph(
			rootRequest,
			preparedByAssetId,
		);
	}

	dispose(): void {
		this.disposed = true;
		this.worker.terminate();
		const error = new Error(
			"Asset channel was disposed before preparation completed.",
		);
		for (const entry of this.loadEntriesByAssetId.values()) {
			entry.responseReject?.(error);
		}
		this.loadEntriesByAssetId.clear();
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	private getOrCreateLoadEntry(assetId: string): AssetLoadEntry {
		const existing = this.loadEntriesByAssetId.get(assetId);
		if (existing) {
			return existing;
		}

		const entry: AssetLoadEntry = {
			responseRequestId: null,
			responsePromise: null,
			responseReject: null,
			preparedRequestId: null,
			preparedPromise: null,
		};
		this.loadEntriesByAssetId.set(assetId, entry);
		return entry;
	}

	private clearResponseLoadEntry(assetId: string, requestId: string): void {
		const entry = this.loadEntriesByAssetId.get(assetId);
		if (!entry || entry.responseRequestId !== requestId) {
			return;
		}

		entry.responseRequestId = null;
		entry.responsePromise = null;
		entry.responseReject = null;
		this.deleteLoadEntryIfIdle(assetId, entry);
	}

	private clearPreparedLoadEntry(assetId: string, requestId: string): void {
		const entry = this.loadEntriesByAssetId.get(assetId);
		if (!entry || entry.preparedRequestId !== requestId) {
			return;
		}

		entry.preparedRequestId = null;
		entry.preparedPromise = null;
		entry.responseRequestId = null;
		entry.responsePromise = null;
		entry.responseReject = null;
		this.deleteLoadEntryIfIdle(assetId, entry);
	}

	private deleteLoadEntryIfIdle(assetId: string, entry: AssetLoadEntry): void {
		if (!entry.responsePromise && !entry.preparedPromise) {
			this.loadEntriesByAssetId.delete(assetId);
		}
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Asset channel was disposed before work completed.");
		}
	}
}

function rebindPreparedAssetRequest(
	asset: PreparedAssetRecord,
	request: AssetLookupRequestDto,
): PreparedAssetRecord {
	return {
		...asset,
		request,
		response: {
			...asset.response,
			requestId: request.requestId,
			assetId: request.assetId,
		},
	};
}

function rebindLookedUpAssetResponse(
	lookedUp: LookedUpAssetResponse,
	request: AssetLookupRequestDto,
): LookedUpAssetResponse {
	return {
		...lookedUp,
		request,
		response: rebindAssetLookupResponse(lookedUp.response, request),
	};
}

function rebindAssetLookupResponse(
	response: AssetLookupResponseDto,
	request: AssetLookupRequestDto,
): AssetLookupResponseDto {
	return {
		...response,
		requestId: request.requestId,
		assetId: request.assetId,
	};
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}
