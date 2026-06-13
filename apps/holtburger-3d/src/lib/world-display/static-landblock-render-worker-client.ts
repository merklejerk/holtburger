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
import {
	logTemporaryRenderRegressionDiagnostic,
	readTemporaryRenderRegressionDiagnostics,
	type TemporaryRenderRegressionDiagnostics,
} from "./render-regression-diagnostics";

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
	renderRegressionDiagnostics?: TemporaryRenderRegressionDiagnostics;
}

interface PendingLandblockRenderRequest {
	desired: DesiredLandblockRenderProduct;
	requestId: string;
	job: LandblockRenderProductWorkerJob;
	artifactKey: string;
	identityKey: string;
	queuedAtMs: number;
	postedAtMs: number | null;
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
	private readonly renderRegressionDiagnostics: TemporaryRenderRegressionDiagnostics;

	constructor(options: StaticLandblockRenderWorkerClientOptions = {}) {
		this.lookupAssetsFn = options.lookupAssetsFn ?? lookupBinaryAssetEnvelopes;
		this.maxConcurrentJobs = options.maxConcurrentJobs ?? 1;
		this.renderRegressionDiagnostics =
			options.renderRegressionDiagnostics ??
			readTemporaryRenderRegressionDiagnostics();
		if (
			!Number.isInteger(this.maxConcurrentJobs) ||
			this.maxConcurrentJobs < 1
		) {
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
		const job = createLandblockRenderProductWorkerJob(
			desired,
			this.renderRegressionDiagnostics.artifactFilter,
		);
		const identityKey = formatJobIdentityKey(job);
		const existing = this.pendingRequestByIdentity.get(identityKey);
		if (existing) {
			return existing;
		}
		const artifactKey = formatArtifactKey(job);
		this.latestIdentityByArtifactKey.set(artifactKey, identityKey);
		this.cancelSupersededRequests(artifactKey, identityKey);
		const requestId = `static-landblock-render-${this.nextRequestSequence++}`;
		const promise = this.enqueueJob(
			requestId,
			desired,
			job,
			artifactKey,
			identityKey,
		);
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
		pending: PendingLandblockRenderRequest,
	): void {
		this.throwIfDisposed();
		this.pendingRequests.set(requestId, pending);
		pending.postedAtMs = nowMs();
		logTemporaryRenderRegressionDiagnostic(
			"worker-post",
			{
				requestId,
				jobId: job.jobId,
				landblockId: job.landblockId,
				product: job.product,
				artifactFilter: formatArtifactFilterForLog(job.artifactFilter),
				queuedMs: roundMs(pending.postedAtMs - pending.queuedAtMs),
				activeRequestCount: this.pendingRequests.size,
				queuedRequestCount: this.queuedRequests.length,
			},
			this.renderRegressionDiagnostics,
		);
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
		artifactKey: string,
		identityKey: string,
	): Promise<LandblockRenderProductWorkerResult> {
		this.throwIfDisposed();
		return new Promise((resolve, reject) => {
			this.queuedRequests.push({
				desired,
				requestId,
				job,
				artifactKey,
				identityKey,
				queuedAtMs: nowMs(),
				postedAtMs: null,
				resolve,
				reject,
			});
			this.queuedRequests.sort(comparePendingLandblockRenderRequests);
			this.pumpQueuedRequests();
		});
	}

	private cancelSupersededRequests(
		artifactKey: string,
		latestIdentityKey: string,
	): void {
		const supersededError = new Error(
			"Static landblock render product request was superseded before completion.",
		);
		for (let index = this.queuedRequests.length - 1; index >= 0; index -= 1) {
			const pending = this.queuedRequests[index];
			if (
				pending?.artifactKey !== artifactKey ||
				pending.identityKey === latestIdentityKey
			) {
				continue;
			}
			this.queuedRequests.splice(index, 1);
			this.pendingRequestByIdentity.delete(pending.identityKey);
			pending.reject(supersededError);
		}
		for (const [requestId, pending] of [...this.pendingRequests.entries()]) {
			if (
				pending.artifactKey !== artifactKey ||
				pending.identityKey === latestIdentityKey
			) {
				continue;
			}
			this.pendingRequests.delete(requestId);
			this.pendingRequestByIdentity.delete(pending.identityKey);
			this.worker.postMessage({
				type: "cancel-landblock-render-product-job",
				requestId,
			});
			pending.reject(supersededError);
		}
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
			this.postJob(pending.requestId, pending.job, pending);
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
			this.reportWorkerCompletion("worker-error", pending, {
				message: message.message,
			});
			pending.reject(new Error(message.message));
			this.pumpQueuedRequests();
			return;
		}
		if (
			!this.isLatestResult(pending.job, pending.identityKey, message.result)
		) {
			this.reportWorkerCompletion("worker-stale-result", pending, {
				resultJobId: message.result.jobId,
			});
			pending.reject(
				new Error(
					`Ignored stale landblock render product result ${message.result.jobId}.`,
				),
			);
			this.pumpQueuedRequests();
			return;
		}
		this.reportWorkerCompletion("worker-complete", pending, {
			resultJobId: message.result.jobId,
			artifactCounts: countResultArtifacts(message.result),
			diagnosticStatus: message.result.diagnostics.status,
			diagnosticMessages: message.result.diagnostics.messages.slice(0, 6),
		});
		pending.resolve(message.result);
		this.pumpQueuedRequests();
	}

	private reportWorkerCompletion(
		label: string,
		pending: PendingLandblockRenderRequest,
		extra: Record<string, unknown>,
	): void {
		const completedAtMs = nowMs();
		logTemporaryRenderRegressionDiagnostic(
			label,
			{
				requestId: pending.requestId,
				jobId: pending.job.jobId,
				landblockId: pending.job.landblockId,
				product: pending.job.product,
				artifactFilter: formatArtifactFilterForLog(pending.job.artifactFilter),
				totalMs: roundMs(completedAtMs - pending.queuedAtMs),
				workerMs:
					pending.postedAtMs === null
						? null
						: roundMs(completedAtMs - pending.postedAtMs),
				activeRequestCount: this.pendingRequests.size,
				queuedRequestCount: this.queuedRequests.length,
				...extra,
			},
			this.renderRegressionDiagnostics,
		);
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
			const startedAtMs = nowMs();
			const envelopes = await profileBrowserJsScopeAsync(
				"static-landblock-render-worker-client.hostLookupBinary",
				() => this.lookupAssetsFn(message.requests),
			);
			logTemporaryRenderRegressionDiagnostic(
				"worker-host-lookup",
				{
					requestId: message.requestId,
					requestCount: message.requests.length,
					durationMs: roundMs(nowMs() - startedAtMs),
					requestSamples: message.requests
						.map((request) => request.assetId)
						.slice(0, 12),
				},
				this.renderRegressionDiagnostics,
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
		formatArtifactFilterForLog(job.artifactFilter),
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

function countResultArtifacts(
	result: LandblockRenderProductWorkerResult,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const artifact of result.artifacts) {
		counts[artifact.artifactKind] = (counts[artifact.artifactKind] ?? 0) + 1;
	}
	return counts;
}

function formatArtifactFilterForLog(
	artifactFilter: LandblockRenderProductWorkerJob["artifactFilter"],
): string {
	return artifactFilter ? artifactFilter.join(",") : "all";
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}
