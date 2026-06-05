import {
	lookupBinaryAssetEnvelopes,
	type BinaryAssetLookupEnvelopeDto,
} from "../host/tauri";
import {
	profileBrowserJsScopeAsync,
	recordBrowserJsProfileSample,
} from "../diagnostics/browser-js-profiler";
import type { AssetLookupRequestDto } from "../host/contracts";
import {
	compareDesiredLandblockRenderProducts,
	createLandblockRenderProductWorkerJob,
	type DesiredLandblockRenderProduct,
	type LandblockRenderProductWorkerJob,
	type LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import type {
	StaticLandblockRenderWorkerHostBinaryEnvelope,
	StaticLandblockRenderWorkerHostLookupBinaryRequestMessage,
	StaticLandblockRenderWorkerRequestMessage,
	StaticLandblockRenderWorkerResponseMessage,
} from "../../workers/static-landblock-render-worker";

export interface StaticLandblockRenderWorkerLike {
	onmessage:
		| ((
				event: MessageEvent<StaticLandblockRenderWorkerResponseMessage>,
		  ) => void)
		| null;
	onerror: ((event: Event | ErrorEvent) => void) | null;
	onmessageerror?: ((event: MessageEvent) => void) | null;
	postMessage(
		message: StaticLandblockRenderWorkerRequestMessage,
		transferables?: Transferable[],
	): void;
	terminate(): void;
}

type BinaryAssetLookupFn = (
	requests: readonly AssetLookupRequestDto[],
) => Promise<BinaryAssetLookupEnvelopeDto[]>;

export interface StaticLandblockRenderWorkerClientOptions {
	lookupAssetsFn?: BinaryAssetLookupFn;
	workerFactory?: () => StaticLandblockRenderWorkerLike;
	maxConcurrentJobs?: number;
}

interface PendingLandblockRenderRequest {
	desired: DesiredLandblockRenderProduct;
	requestId: string;
	job: LandblockRenderProductWorkerJob;
	identityKey: string;
	resolve: (result: LandblockRenderProductWorkerResult) => void;
	reject: (error: Error) => void;
}

export class StaticLandblockRenderWorkerClient {
	private readonly worker: StaticLandblockRenderWorkerLike;
	private readonly pendingRequests = new Map<
		string,
		PendingLandblockRenderRequest
	>();
	private readonly queuedRequests: PendingLandblockRenderRequest[] = [];
	private readonly latestIdentityByArtifactKey = new Map<string, string>();
	private readonly pendingRequestByIdentity = new Map<
		string,
		Promise<LandblockRenderProductWorkerResult>
	>();
	private nextRequestSequence = 1;
	private disposed = false;
	private readonly lookupAssetsFn: BinaryAssetLookupFn;
	private readonly maxConcurrentJobs: number;

	constructor(options: StaticLandblockRenderWorkerClientOptions = {}) {
		this.lookupAssetsFn = options.lookupAssetsFn ?? lookupBinaryAssetEnvelopes;
		this.maxConcurrentJobs = options.maxConcurrentJobs ?? 2;
		if (!Number.isInteger(this.maxConcurrentJobs) || this.maxConcurrentJobs < 1) {
			throw new Error(
				"Static landblock render worker client requires maxConcurrentJobs >= 1.",
			);
		}
		const workerFactory = options.workerFactory ?? createWorker;
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const message = event.data;
			if (message.type === "host-lookup-assets-binary") {
				void this.handleWorkerHostLookupBinary(message);
				return;
			}
			this.handleWorkerResult(message);
		};
		this.worker.onerror = (event) => {
			const errorMessage =
				event instanceof ErrorEvent
					? event.message
					: "Static landblock render worker failed before work completed.";
			this.rejectAllPending(new Error(errorMessage));
		};
		this.worker.onmessageerror = () => {
			this.rejectAllPending(
				new Error(
					"Static landblock render worker posted an unreadable message.",
				),
			);
		};
	}

	requestProduct(
		desired: DesiredLandblockRenderProduct,
	): Promise<LandblockRenderProductWorkerResult> {
		const job = createLandblockRenderProductWorkerJob(desired);
		const identityKey = formatJobIdentityKey(job);
		const existing = this.pendingRequestByIdentity.get(identityKey);
		if (existing) {
			return existing;
		}
		const artifactKey = formatArtifactKey(job);
		this.latestIdentityByArtifactKey.set(artifactKey, identityKey);
		const requestId = `static-landblock-render-${this.nextRequestSequence++}`;
		const promise = this.enqueueJob(requestId, desired, job, identityKey);
		this.pendingRequestByIdentity.set(identityKey, promise);
		promise.then(
			() => {
				this.pendingRequestByIdentity.delete(identityKey);
			},
			() => {
				this.pendingRequestByIdentity.delete(identityKey);
			},
		);
		return promise;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.worker.terminate();
		this.rejectAllPending(
			new Error(
				"Static landblock render worker was disposed before work completed.",
			),
		);
	}

	private postJob(
		requestId: string,
		job: LandblockRenderProductWorkerJob,
		identityKey: string,
		pending: PendingLandblockRenderRequest,
	): void {
		this.throwIfDisposed();
		this.pendingRequests.set(requestId, pending);
		try {
			this.worker.postMessage({
				type: "run-landblock-render-product-job",
				requestId,
				job,
			});
		} catch (error) {
			this.pendingRequests.delete(requestId);
			pending.reject(toError(error));
			this.pumpQueuedRequests();
		}
	}

	private enqueueJob(
		requestId: string,
		desired: DesiredLandblockRenderProduct,
		job: LandblockRenderProductWorkerJob,
		identityKey: string,
	): Promise<LandblockRenderProductWorkerResult> {
		this.throwIfDisposed();
		return new Promise((resolve, reject) => {
			this.queuedRequests.push({
				desired,
				requestId,
				job,
				identityKey,
				resolve,
				reject,
			});
			this.queuedRequests.sort(comparePendingLandblockRenderRequests);
			this.pumpQueuedRequests();
		});
	}

	private pumpQueuedRequests(): void {
		if (this.disposed) {
			return;
		}
		while (
			this.pendingRequests.size < this.maxConcurrentJobs &&
			this.queuedRequests.length > 0
		) {
			const pending = this.queuedRequests.shift();
			if (!pending) {
				return;
			}
			this.postJob(pending.requestId, pending.job, pending.identityKey, pending);
		}
	}

	private handleWorkerResult(
		message: Exclude<
			StaticLandblockRenderWorkerResponseMessage,
			StaticLandblockRenderWorkerHostLookupBinaryRequestMessage
		>,
	): void {
		const pending = this.pendingRequests.get(message.requestId);
		if (!pending) {
			return;
		}
		this.pendingRequests.delete(message.requestId);
		if (message.type === "landblock-render-product-job-error") {
			pending.reject(new Error(message.message));
			this.pumpQueuedRequests();
			return;
		}
		if (
			!this.isLatestResult(pending.job, pending.identityKey, message.result)
		) {
			pending.reject(
				new Error(
					`Ignored stale landblock render product result ${message.result.jobId}.`,
				),
			);
			this.pumpQueuedRequests();
			return;
		}
		pending.resolve(message.result);
		this.pumpQueuedRequests();
	}

	private isLatestResult(
		job: LandblockRenderProductWorkerJob,
		identityKey: string,
		result: LandblockRenderProductWorkerResult,
	): boolean {
		return (
			result.landblockId === job.landblockId &&
			result.product === job.product &&
			result.requestId === job.requestId &&
			result.buildPolicyRevision === job.buildPolicyRevision &&
			result.texturePagePolicyRevision === job.texturePagePolicyRevision &&
			this.latestIdentityByArtifactKey.get(formatArtifactKey(job)) ===
				identityKey
		);
	}

	private async handleWorkerHostLookupBinary(
		message: StaticLandblockRenderWorkerHostLookupBinaryRequestMessage,
	): Promise<void> {
		try {
			const envelopes = await profileBrowserJsScopeAsync(
				"static-landblock-render-worker-client.hostLookupBinary",
				() => this.lookupAssetsFn(message.requests),
			);
			const workerEnvelopes = envelopes.map((envelope) => ({
				payload: envelope.payload,
			})) satisfies StaticLandblockRenderWorkerHostBinaryEnvelope[];
			recordBrowserJsProfileSample(
				"static-landblock-render-worker-client.hostLookupBinary.requestCount",
				message.requests.length,
			);
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

	private rejectAllPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		for (const pending of this.queuedRequests.splice(0)) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
		this.pendingRequestByIdentity.clear();
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Static landblock render worker was disposed.");
		}
	}
}

function formatArtifactKey(job: LandblockRenderProductWorkerJob): string {
	return `${job.landblockId}:${job.product}`;
}

function formatJobIdentityKey(job: LandblockRenderProductWorkerJob): string {
	return [
		formatArtifactKey(job),
		job.requestId,
		job.buildPolicyRevision,
		job.texturePagePolicyRevision,
	].join(":");
}

function comparePendingLandblockRenderRequests(
	left: PendingLandblockRenderRequest,
	right: PendingLandblockRenderRequest,
): number {
	const desiredOrder = compareDesiredLandblockRenderProducts(
		left.desired,
		right.desired,
	);
	return desiredOrder !== 0
		? desiredOrder
		: left.requestId.localeCompare(right.requestId);
}

function createWorker(): StaticLandblockRenderWorkerLike {
	return new Worker(
		new URL("../../workers/static-landblock-render-worker.ts", import.meta.url),
		{
			type: "module",
		},
	) as unknown as StaticLandblockRenderWorkerLike;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
