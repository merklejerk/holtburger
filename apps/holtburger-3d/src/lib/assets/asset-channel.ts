import type {
	AssetLookupRequestDto,
} from "../host/contracts";
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
	AssetWorkerPreparedResult,
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
	AssetWorkerReadyProfile,
} from "../../workers/asset-worker";
import type { FrontendProfiler } from "../performance/frontend-profiler";

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
		private readonly profiler?: FrontendProfiler,
	) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const receivedAtEpochMs = performance.timeOrigin + performance.now();
			const message = event.data;
			if (message.type === "host-lookup-assets-binary") {
				this.profiler?.recordFrameWork("asset-host.worker-request", {
					requestCount: message.requests.length,
					priority: commonPriority(message.requests),
					pendingCount: this.pendingRequests.size,
				});
				void this.handleWorkerHostLookupBinary(message);
				return;
			}

			this.recordWorkerResultFrameWork(message.results);
			for (const result of message.results) {
				if (result.type === "asset-ready") {
					this.recordWorkerReadyProfile(result.profile, receivedAtEpochMs);
					if (this.profiler) {
						this.profiler.measureSync(
							`asset-worker.message-handler.${result.profile.assetKind}`,
							createWorkerProfileDetail(result.profile),
							() => {
								this.resolvePreparedAsset(result.asset);
							},
						);
					} else {
						this.resolvePreparedAsset(result.asset);
					}
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
			this.profiler?.recordEvent("asset-channel.prepare-cache-hit", {
				assetId: request.assetId,
				priority: request.priority,
			});
			return rebindPreparedAssetRequest(await entry.preparedPromise, request);
		}

		this.profiler?.recordEvent("asset-channel.prepare-cache-miss", {
			assetId: request.assetId,
			priority: request.priority,
		});
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
			for (const pending of pendingRequests) {
				this.postPrepareRequest(pending);
			}
		} catch (error) {
			const normalized = toError(error);
			for (const pending of pendingRequests) {
				this.pendingRequests.delete(pending.request.requestId);
				pending.reject(normalized);
			}
		}
	}

	private postPrepareRequest(pending: PendingAssetRequest): void {
		const mainPostStartedAtEpochMs = performance.timeOrigin + performance.now();
		const message = {
			type: "prepare-assets",
			items: [
				{
					request: pending.request,
					mainPostStartedAtEpochMs,
				},
			],
		} satisfies AssetWorkerRequestMessage;
		if (this.profiler) {
			this.profiler.measureSync(
				"asset-worker.post-message",
				{
					requestCount: 1,
					priority: pending.request.priority,
				},
				() => this.worker.postMessage(message),
			);
		} else {
			this.worker.postMessage(message);
		}
	}

	private async handleWorkerHostLookupBinary(
		message: AssetWorkerHostLookupBinaryRequestMessage,
	): Promise<void> {
		const mainRequestReceivedAtEpochMs =
			performance.timeOrigin + performance.now();
		try {
			const mainLookupStartedAtEpochMs =
				performance.timeOrigin + performance.now();
			const envelopes = await (this.profiler?.measureAsync(
				"asset-channel.lookup-host-batch",
				{
					requestCount: message.requests.length,
					priority: commonPriority(message.requests),
					responseMode: "raw-envelope",
				},
				() => this.lookupAssetsFn(message.requests),
			) ?? this.lookupAssetsFn(message.requests));
			const mainLookupEndedAtEpochMs =
				performance.timeOrigin + performance.now();
			const workerEnvelopes = envelopes.map((envelope) => ({
				payload: envelope.payload,
			})) satisfies AssetWorkerHostBinaryEnvelope[];
			const byteLength = workerEnvelopes.reduce(
				(total, envelope) => total + envelope.payload.byteLength,
				0,
			);
			this.profiler?.recordFrameWork("asset-host.worker-response", {
				requestCount: message.requests.length,
				priority: commonPriority(message.requests),
				byteLength,
				byteLengthBucket: bucketBytes(byteLength),
			});
			this.worker.postMessage(
				{
					type: "host-lookup-assets-binary-complete",
					requestId: message.requestId,
					envelopes: workerEnvelopes,
					workerRequestPostedAtEpochMs: message.workerPostStartedAtEpochMs,
					mainRequestReceivedAtEpochMs,
					mainLookupStartedAtEpochMs,
					mainLookupEndedAtEpochMs,
					mainResponsePostStartedAtEpochMs:
						performance.timeOrigin + performance.now(),
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

	private recordWorkerReadyProfile(
		profile: AssetWorkerReadyProfile,
		receivedAtEpochMs: number,
	): void {
		const detail = createWorkerProfileDetail(profile);
		this.profiler?.recordDuration(
			`asset-worker.main-to-worker-latency.${profile.assetKind}`,
			profile.workerReceivedAtEpochMs - profile.mainPostStartedAtEpochMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-worker.host-lookup-wait.${profile.assetKind}`,
			profile.hostLookupEndedAtMs - profile.hostLookupStartedAtMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-bridge.worker-to-main.${profile.assetKind}`,
			profile.mainHostRequestReceivedAtEpochMs -
				profile.workerHostRequestPostedAtEpochMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-bridge.main-lookup.${profile.assetKind}`,
			profile.mainHostLookupEndedAtEpochMs -
				profile.mainHostLookupStartedAtEpochMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-bridge.main-to-worker.${profile.assetKind}`,
			profile.workerHostResponseReceivedAtEpochMs -
				profile.mainHostResponsePostStartedAtEpochMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-bridge.roundtrip.${profile.assetKind}`,
			profile.workerHostResponseReceivedAtEpochMs -
				profile.workerHostRequestPostedAtEpochMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-worker.decode-binary-envelope.${profile.assetKind}`,
			profile.decodeEndedAtMs - profile.decodeStartedAtMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-host.rust-asset-load.${profile.assetKind}`,
			profile.rustAssetLoadMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-host.rust-response-serialize.${profile.assetKind}`,
			profile.rustResponseSerializeMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-worker.prepare-payload.${profile.assetKind}`,
			profile.prepareEndedAtMs - profile.prepareStartedAtMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-worker.collect-transferables.${profile.assetKind}`,
			profile.transferCollectEndedAtMs - profile.transferCollectStartedAtMs,
			detail,
		);
		this.profiler?.recordDuration(
			`asset-worker.message-latency.${profile.assetKind}`,
			receivedAtEpochMs - profile.postStartedAtEpochMs,
			detail,
		);
		this.profiler?.recordEvent("asset-worker.ready", detail);
	}

	private recordWorkerResultFrameWork(
		results: readonly AssetWorkerPreparedResult[],
	): void {
		if (!this.profiler) {
			return;
		}

		let errorCount = 0;
		const countsByKind = new Map<
			string,
			{
				resultCount: number;
				geometryBytes: number;
				transferableBytes: number;
			}
		>();
		for (const result of results) {
			if (result.type === "asset-error") {
				errorCount += 1;
				continue;
			}

			const kind = result.profile.assetKind;
			const existing = countsByKind.get(kind) ?? {
				resultCount: 0,
				geometryBytes: 0,
				transferableBytes: 0,
			};
			existing.resultCount += 1;
			existing.geometryBytes += result.profile.geometryBytes;
			existing.transferableBytes += result.profile.transferableBytes;
			countsByKind.set(kind, existing);
		}

		for (const [assetKind, counts] of countsByKind) {
			this.profiler.recordFrameWork("asset-worker.results", {
				assetKind,
				resultCount: counts.resultCount,
				geometryBytes: counts.geometryBytes,
				geometryBytesBucket: bucketBytes(counts.geometryBytes),
				transferableBytes: counts.transferableBytes,
				transferableBytesBucket: bucketBytes(counts.transferableBytes),
				pendingCount: this.pendingRequests.size,
			});
		}
		if (errorCount > 0) {
			this.profiler.recordFrameWork("asset-worker.errors", {
				errorCount,
				pendingCount: this.pendingRequests.size,
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

function createWorkerProfileDetail(
	profile: AssetWorkerReadyProfile,
): Record<string, unknown> {
	return {
		assetKind: profile.assetKind,
		geometryBytes: profile.geometryBytes,
		geometryBytesBucket: bucketBytes(profile.geometryBytes),
		transferableBytes: profile.transferableBytes,
		transferableBytesBucket: bucketBytes(profile.transferableBytes),
		transferableCount: profile.transferableCount,
		requestCount: profile.hostRequestCount,
		byteLength: profile.hostResponseByteLength,
		byteLengthBucket: bucketBytes(profile.hostResponseByteLength),
		mainPostPayloadKind: profile.mainPostPayloadKind,
	};
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

function bucketBytes(byteCount: number): string {
	if (byteCount === 0) {
		return "0";
	}
	if (byteCount < 16 * 1024) {
		return "<16KiB";
	}
	if (byteCount < 64 * 1024) {
		return "16-64KiB";
	}
	if (byteCount < 256 * 1024) {
		return "64-256KiB";
	}
	if (byteCount < 1024 * 1024) {
		return "256KiB-1MiB";
	}
	return ">=1MiB";
}

function commonPriority(requests: readonly AssetLookupRequestDto[]): string {
	const [first] = requests;
	if (!first) {
		return "none";
	}
	return requests.every((request) => request.priority === first.priority)
		? first.priority
		: "mixed";
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}
