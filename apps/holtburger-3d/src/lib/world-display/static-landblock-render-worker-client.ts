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
	createLandblockRenderPresetWorkerJob,
	type DesiredLandblockRenderPreset,
	type LandblockRenderPresetWorkerJob,
	type LandblockRenderPresetWorkerResult,
} from "./landblock-render-preset";
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
	postMessage(
		message: StaticLandblockRenderWorkerRequestMessage,
		transferables?: Transferable[],
	): void;
	terminate(): void;
}

type BinaryAssetLookupFn = (
	requests: readonly AssetLookupRequestDto[],
) => Promise<BinaryAssetLookupEnvelopeDto[]>;

interface PendingLandblockRenderRequest {
	job: LandblockRenderPresetWorkerJob;
	identityKey: string;
	resolve: (result: LandblockRenderPresetWorkerResult) => void;
	reject: (error: Error) => void;
}

export class StaticLandblockRenderWorkerClient {
	private readonly worker: StaticLandblockRenderWorkerLike;
	private readonly pendingRequests = new Map<
		string,
		PendingLandblockRenderRequest
	>();
	private readonly latestIdentityByArtifactKey = new Map<string, string>();
	private readonly pendingRequestByIdentity = new Map<
		string,
		Promise<LandblockRenderPresetWorkerResult>
	>();
	private nextRequestSequence = 1;
	private disposed = false;

	constructor(
		private readonly lookupAssetsFn: BinaryAssetLookupFn = lookupBinaryAssetEnvelopes,
		workerFactory: () => StaticLandblockRenderWorkerLike = createWorker,
	) {
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
	}

	requestPreset(
		desired: DesiredLandblockRenderPreset,
	): Promise<LandblockRenderPresetWorkerResult> {
		const job = createLandblockRenderPresetWorkerJob(desired);
		const identityKey = formatJobIdentityKey(job);
		const existing = this.pendingRequestByIdentity.get(identityKey);
		if (existing) {
			return existing;
		}
		const artifactKey = formatArtifactKey(job);
		this.latestIdentityByArtifactKey.set(artifactKey, identityKey);
		const requestId = `static-landblock-render-${this.nextRequestSequence++}`;
		const promise = this.postJob(requestId, job, identityKey);
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
		job: LandblockRenderPresetWorkerJob,
		identityKey: string,
	): Promise<LandblockRenderPresetWorkerResult> {
		this.throwIfDisposed();
		return new Promise((resolve, reject) => {
			this.pendingRequests.set(requestId, {
				job,
				identityKey,
				resolve,
				reject,
			});
			try {
				this.worker.postMessage({
					type: "run-landblock-render-preset-job",
					requestId,
					job,
				});
			} catch (error) {
				this.pendingRequests.delete(requestId);
				reject(toError(error));
			}
		});
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
		if (message.type === "landblock-render-preset-job-error") {
			pending.reject(new Error(message.message));
			return;
		}
		if (!this.isLatestResult(pending.job, pending.identityKey, message.result)) {
			pending.reject(
				new Error(
					`Ignored stale landblock render preset result ${message.result.jobId}.`,
				),
			);
			return;
		}
		pending.resolve(message.result);
	}

	private isLatestResult(
		job: LandblockRenderPresetWorkerJob,
		identityKey: string,
		result: LandblockRenderPresetWorkerResult,
	): boolean {
		return (
			result.landblockId === job.landblockId &&
			result.preset === job.preset &&
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
		this.pendingRequests.clear();
		this.pendingRequestByIdentity.clear();
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Static landblock render worker was disposed.");
		}
	}
}

function formatArtifactKey(job: LandblockRenderPresetWorkerJob): string {
	return `${job.landblockId}:${job.preset}`;
}

function formatJobIdentityKey(job: LandblockRenderPresetWorkerJob): string {
	return [
		formatArtifactKey(job),
		job.requestId,
		job.buildPolicyRevision,
		job.texturePagePolicyRevision,
	].join(":");
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
