import {
	buildIndexedResourceAtlasWorkerResult,
	collectBuildIndexedResourceAtlasResultTransferables,
	type BuildIndexedResourceAtlasWorkerJob,
	type BuildIndexedResourceAtlasWorkerResult,
} from "../lib/world-display/worker-resources/indexed-atlas-worker-payloads";
import {
	buildTextureAtlasWorkerResult,
	collectBuildTextureAtlasResultTransferables,
	type BuildTextureAtlasWorkerJob,
	type BuildTextureAtlasWorkerResult,
} from "../lib/world-display/worker-resources/texture-atlas-worker-payloads";

export type RenderResourceWorkerJobKind =
	| "build-indexed-resource-atlas"
	| "build-texture-atlas";

export interface RenderResourceWorkerRunJobMessage {
	type: "run-job";
	requestId: string;
	job: RenderResourceWorkerJob;
}

export interface RenderResourceWorkerJobCompleteMessage {
	type: "job-complete";
	requestId: string;
	result: RenderResourceWorkerJobResult;
	durationMs: number;
}

export interface RenderResourceWorkerJobErrorMessage {
	type: "job-error";
	requestId: string;
	message: string;
}

export type RenderResourceWorkerJob =
	| BuildIndexedResourceAtlasWorkerJob
	| BuildTextureAtlasWorkerJob;
export type RenderResourceWorkerJobResult =
	| BuildIndexedResourceAtlasWorkerResult
	| BuildTextureAtlasWorkerResult;
export type RenderResourceWorkerRequestMessage =
	RenderResourceWorkerRunJobMessage;
export type RenderResourceWorkerResponseMessage =
	| RenderResourceWorkerJobCompleteMessage
	| RenderResourceWorkerJobErrorMessage;

type RenderResourceWorkerRequestEvent =
	MessageEvent<RenderResourceWorkerRequestMessage>;

interface RenderResourceWorkerScope {
	onmessage: ((event: RenderResourceWorkerRequestEvent) => void) | null;
	postMessage(
		message: RenderResourceWorkerResponseMessage,
		transferables?: Transferable[],
	): void;
}

const workerScope =
	typeof self === "undefined"
		? null
		: (self as unknown as RenderResourceWorkerScope);

if (workerScope) {
	workerScope.onmessage = (event: RenderResourceWorkerRequestEvent) => {
		const message = event.data;
		const startedAt = performance.now();
		try {
			const result = runRenderResourceWorkerJob(message.job);
			const response = {
				type: "job-complete",
				requestId: message.requestId,
				result,
				durationMs: performance.now() - startedAt,
			} satisfies RenderResourceWorkerResponseMessage;
			workerScope.postMessage(
				response,
				collectRenderResourceWorkerResultTransferables(result),
			);
		} catch (error) {
			const response = {
				type: "job-error",
				requestId: message.requestId,
				message: error instanceof Error ? error.message : String(error),
			} satisfies RenderResourceWorkerResponseMessage;
			workerScope.postMessage(response);
		}
	};
}

export function runRenderResourceWorkerJob(
	job: RenderResourceWorkerJob,
): RenderResourceWorkerJobResult {
	switch (job.type) {
		case "build-indexed-resource-atlas":
			return buildIndexedResourceAtlasWorkerResult(job.input);
		case "build-texture-atlas":
			return buildTextureAtlasWorkerResult(job.input);
	}
}

function collectRenderResourceWorkerResultTransferables(
	result: RenderResourceWorkerJobResult,
): Transferable[] {
	switch (result.type) {
		case "build-indexed-resource-atlas":
			return collectBuildIndexedResourceAtlasResultTransferables(result);
		case "build-texture-atlas":
			return collectBuildTextureAtlasResultTransferables(result);
	}
}
