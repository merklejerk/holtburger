import {
	buildCompactedGeometryWorkerResult,
	collectBuildCompactedGeometryResultTransferables,
	type BuildCompactedGeometryWorkerJob,
	type BuildCompactedGeometryWorkerResult,
} from "../lib/world-display/worker-resources/compacted-geometry-worker-payloads";

export type RenderResourceWorkerJobKind = "echo" | "build-compacted-geometry";

export interface RenderResourceWorkerEchoJob {
	type: "echo";
	key: string;
	payload: string;
}

export interface RenderResourceWorkerEchoResult {
	type: "echo";
	key: string;
	payload: string;
}

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
	| RenderResourceWorkerEchoJob
	| BuildCompactedGeometryWorkerJob;
export type RenderResourceWorkerJobResult =
	| RenderResourceWorkerEchoResult
	| BuildCompactedGeometryWorkerResult;
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
		case "echo":
			return {
				type: "echo",
				key: job.key,
				payload: job.payload,
			};
		case "build-compacted-geometry":
			return buildCompactedGeometryWorkerResult(job.input);
	}
}

function collectRenderResourceWorkerResultTransferables(
	result: RenderResourceWorkerJobResult,
): Transferable[] {
	switch (result.type) {
		case "echo":
			return [];
		case "build-compacted-geometry":
			return collectBuildCompactedGeometryResultTransferables(result);
	}
}
