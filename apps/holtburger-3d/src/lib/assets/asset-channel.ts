import type { AssetLookupRequestDto } from "../host/contracts";
import {
	lookupBinaryAssetEnvelopes,
	type BinaryAssetLookupEnvelopeDto,
} from "../host/tauri";
import {
	AssetGraphScheduler,
	type AssetGraphPreparationResult,
} from "./asset-graph-scheduler";
import type { PreparedAssetRecord } from "./types";
import type {
	AssetWorkerHostBinaryEnvelope,
	AssetWorkerHostLookupBinaryRequestMessage,
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";

export interface AssetWorkerLike {
	onmessage: ((event: MessageEvent<AssetWorkerResponseMessage>) => void) | null;
	onerror: ((event: Event | ErrorEvent) => void) | null;
	postMessage(
		message: AssetWorkerRequestMessage,
		transferables?: Transferable[],
	): void;
	terminate(): void;
}

type AssetLookupBatchFn = (
	requests: readonly AssetLookupRequestDto[],
) => Promise<BinaryAssetLookupEnvelopeDto[]>;

type PendingAssetRequest = {
	request: AssetLookupRequestDto;
	resolve: (asset: PreparedAssetRecord) => void;
	reject: (error: Error) => void;
};

interface AssetLoadEntry {
	preparedRequestId: string | null;
	preparedPromise: Promise<PreparedAssetRecord> | null;
}

export interface AssetPreparationGateway {
	prepareAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<PreparedAssetRecord[]>;
}

export class AssetChannelController {
	private readonly worker: AssetWorkerLike;

	private readonly pendingRequests = new Map<string, PendingAssetRequest>();

	private readonly loadEntriesByAssetId = new Map<string, AssetLoadEntry>();

	private readonly queuedPrepareRequests: PendingAssetRequest[] = [];

	private prepareFlushScheduled = false;

	private disposed = false;

	constructor(
		private readonly lookupAssetsFn: AssetLookupBatchFn = lookupBinaryAssetEnvelopes,
		workerFactory: () => AssetWorkerLike = createAssetWorker,
	) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const message = event.data;
			if (message.type === "host-lookup-assets-binary") {
				void this.handleWorkerHostLookupBinary(message);
				return;
			}

			for (const result of message.results) {
				if (result.type === "asset-ready") {
					this.resolvePreparedAsset(result.asset);
					continue;
				}

				const pending = this.pendingRequests.get(result.requestId);
				if (!pending) {
					continue;
				}

				this.pendingRequests.delete(result.requestId);
				pending.reject(new Error(result.message));
			}
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
		const [asset] = await this.prepareAssets([request]);
		if (!asset) {
			throw new Error(`No prepared asset returned for ${request.assetId}.`);
		}
		return asset;
	}

	async prepareAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<PreparedAssetRecord[]> {
		if (requests.length === 0) {
			return [];
		}
		return Promise.all(
			requests.map((request) => this.prepareAssetSingle(request)),
		);
	}

	private async prepareAssetSingle(
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
				const pending = {
					request,
					resolve,
					reject,
				};
				this.pendingRequests.set(request.requestId, pending);
				this.enqueuePrepareRequest(pending);
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
		this.loadEntriesByAssetId.clear();
		for (const pending of this.queuedPrepareRequests.splice(0)) {
			pending.reject(error);
		}
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
			preparedRequestId: null,
			preparedPromise: null,
		};
		this.loadEntriesByAssetId.set(assetId, entry);
		return entry;
	}

	private clearPreparedLoadEntry(assetId: string, requestId: string): void {
		const entry = this.loadEntriesByAssetId.get(assetId);
		if (!entry || entry.preparedRequestId !== requestId) {
			return;
		}

		entry.preparedRequestId = null;
		entry.preparedPromise = null;
		this.deleteLoadEntryIfIdle(assetId, entry);
	}

	private deleteLoadEntryIfIdle(assetId: string, entry: AssetLoadEntry): void {
		if (!entry.preparedPromise) {
			this.loadEntriesByAssetId.delete(assetId);
		}
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Asset channel was disposed before work completed.");
		}
	}

	private enqueuePrepareRequest(pending: PendingAssetRequest): void {
		this.queuedPrepareRequests.push(pending);
		if (this.prepareFlushScheduled) {
			return;
		}

		this.prepareFlushScheduled = true;
		queueMicrotask(() => {
			this.prepareFlushScheduled = false;
			this.flushPrepareRequests();
		});
	}

	private flushPrepareRequests(): void {
		const pendingRequests = this.queuedPrepareRequests.splice(0);
		if (pendingRequests.length === 0) {
			return;
		}

		try {
			this.throwIfDisposed();
			this.postPrepareRequests(pendingRequests);
		} catch (error) {
			const normalized = toError(error);
			for (const pending of pendingRequests) {
				this.pendingRequests.delete(pending.request.requestId);
				pending.reject(normalized);
			}
		}
	}

	private postPrepareRequests(
		pendingRequests: readonly PendingAssetRequest[],
	): void {
		const message = {
			type: "prepare-assets",
			items: pendingRequests.map((pending) => ({
				request: pending.request,
			})),
		} satisfies AssetWorkerRequestMessage;
		this.worker.postMessage(message);
	}

	private async handleWorkerHostLookupBinary(
		message: AssetWorkerHostLookupBinaryRequestMessage,
	): Promise<void> {
		try {
			const envelopes = await this.lookupAssetsFn(message.requests);
			const workerEnvelopes = envelopes.map((envelope) => ({
				payload: envelope.payload,
			})) satisfies AssetWorkerHostBinaryEnvelope[];
			this.worker.postMessage(
				{
					type: "host-lookup-assets-binary-complete",
					requestId: message.requestId,
					envelopes: workerEnvelopes,
				},
				workerEnvelopes.map((envelope) => envelope.payload),
			);
		} catch (error) {
			this.worker.postMessage({
				type: "host-lookup-assets-binary-error",
				requestId: message.requestId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private resolvePreparedAsset(asset: PreparedAssetRecord): void {
		const pending = this.pendingRequests.get(asset.request.requestId);
		if (!pending) {
			return;
		}

		this.pendingRequests.delete(asset.request.requestId);
		pending.resolve(asset);
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

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(
		new URL(
			"../../workers/asset-worker.ts?asset-worker-diag-2026-05-24a",
			import.meta.url,
		),
		{
			type: "module",
		},
	) as unknown as AssetWorkerLike;
}
