import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticBakerDiagnosticsSnapshot,
	StaticBakerTraceEvent,
} from "../contracts";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerProgress,
} from "./protocol";
import {
	StandardWorkerPool,
	type WorkerPoolDiagnosticsSnapshot,
} from "../../workers/pool";

const MAX_STATIC_BAKER_TRACE_EVENTS = 64;

interface StaticBakeRequestDiagnostics {
	readonly input: StaticBakeJobInput;
	/** Main-thread wall-clock timestamp when this request was submitted. */
	readonly submittedAtEpochMs: number;
	readonly traceEvents: StaticBakerTraceEvent[];
	/** Worker result-ready metadata captured before result delivery, if emitted. */
	resultReady: StaticBakeWorkerResultReadyDiagnostics | null;
	/** Main-thread wall-clock timestamp when worker started progress arrived. */
	startedAtEpochMs: number | null;
}

/** Worker handoff counters captured immediately before the bake worker posts its result. */
interface StaticBakeWorkerResultReadyDiagnostics {
	/** Worker wall-clock timestamp immediately before result postMessage. */
	readonly completedAtEpochMs: number;
	/** Draw units in the result, used as a compact result-size proxy. */
	readonly drawUnitCount: number;
	/** Object visual resources in the result install set. */
	readonly objectVisualResourceCount: number;
	/** Transferable bytes sent with the result message. */
	readonly transferByteLength: number;
	/** Transferable objects sent with the result message. */
	readonly transferCount: number;
}

/** Direct diagnostics for the static bake worker boundary, not a legacy coordinator snapshot. */
interface StaticBakeWorkerBoundaryDiagnostics {
	/** Worker wall-clock timestamp immediately before result postMessage. */
	readonly completedAtEpochMs: number;
	/** Main-thread delay from worker result-ready progress to resolved result delivery. */
	readonly deliveryMs: number | null;
	/** Draw units in the result, used as a compact result-size proxy. */
	readonly drawUnitCount: number;
	/** Object visual resources in the result install set. */
	readonly objectVisualResourceCount: number;
	/** Main-thread wall-clock timestamp when the result promise resolved. */
	readonly resolvedAtEpochMs: number;
	/** Main-thread wall-clock timestamp when this request was submitted. */
	readonly submittedAtEpochMs: number;
	/** Transferable bytes sent with the result message. */
	readonly transferByteLength: number;
	/** Transferable objects sent with the result message. */
	readonly transferCount: number;
	/** Worker execution wait from started progress to result-ready progress. */
	readonly waitMs: number | null;
}

/** Bake result plus direct worker-boundary diagnostics when a worker-backed baker can provide them. */
export interface StaticBakeJobResultWithDiagnostics {
	/** Direct worker-boundary diagnostics, or null for transports that cannot emit result-ready progress. */
	readonly diagnostics: StaticBakeWorkerBoundaryDiagnostics | null;
	/** Static bake result returned by the worker. */
	readonly result: StaticBakeJobResult;
}

export class WorkerPoolStaticBaker implements StaticBaker {
	readonly #baker: StandardStaticWorkerBaker;

	constructor(options: {
		readonly createWorker: () => StaticBakeWorkerPort;
		readonly workerCount: number;
	}) {
		this.#baker = new StandardStaticWorkerBaker(options);
	}

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return this.#baker.bake(input);
	}

	bakeWithDiagnostics(
		input: StaticBakeJobInput,
	): Promise<StaticBakeJobResultWithDiagnostics> {
		return this.#baker.bakeWithDiagnostics(input);
	}

	createDiagnosticsSnapshot(): StaticBakerDiagnosticsSnapshot {
		return this.#baker.createDiagnosticsSnapshot();
	}

	dispose(): void {
		this.#baker.dispose();
	}
}

class StandardStaticWorkerBaker implements StaticBaker {
	readonly #pool: StandardWorkerPool<
		StaticBakeJobInput,
		StaticBakeJobResult,
		StaticBakeWorkerProgress
	>;
	readonly #requests = new Map<string, StaticBakeRequestDiagnostics>();

	constructor(options: {
		readonly createWorker: () => StaticBakeWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			describe: (input) => ({
				label: input.domain,
				taskId: input.task.taskId,
			}),
			requestIdPrefix: "bake-job",
			size: options.workerCount,
		});
	}

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return this.bakeWithDiagnostics(input).then(({ result }) => result);
	}

	async bakeWithDiagnostics(
		input: StaticBakeJobInput,
	): Promise<StaticBakeJobResultWithDiagnostics> {
		let requestId = "";
		const handle = this.#pool.submitHandle(input, {
			onProgress: (event) => this.#recordProgress(requestId, event),
		});
		requestId = handle.requestId;
		this.#requests.set(handle.requestId, {
			input,
			resultReady: null,
			startedAtEpochMs: null,
			submittedAtEpochMs: Date.now(),
			traceEvents: [],
		});
		try {
			const result = await handle.result;
			return {
				diagnostics: this.#createBoundaryDiagnostics(handle.requestId),
				result,
			};
		} finally {
			this.#requests.delete(handle.requestId);
		}
	}

	createDiagnosticsSnapshot(): StaticBakerDiagnosticsSnapshot {
		const poolSnapshot = this.#pool.createDiagnosticsSnapshot();
		const currentNowMs = performance.now();
		return {
			kind: "static-baker",
			pendingJobs: [
				...poolSnapshot.queuedJobs.map((job) =>
					this.#createJobSnapshot(
						poolSnapshot,
						job.requestId,
						"queued",
						currentNowMs,
					),
				),
				...poolSnapshot.activeJobs.map((job) =>
					this.#createJobSnapshot(
						poolSnapshot,
						job.requestId,
						"executing",
						currentNowMs,
					),
				),
			].filter((job) => job !== null),
			workerCount: poolSnapshot.workerCount,
		};
	}

	dispose(): void {
		this.#pool.dispose();
		this.#requests.clear();
	}

	#recordProgress(requestId: string, event: StaticBakeWorkerProgress): void {
		const request = this.#requests.get(requestId);
		if (!request) {
			return;
		}

		if (event.kind === "started") {
			request.startedAtEpochMs = Date.now();
			return;
		}

		if (event.kind === "result-ready") {
			request.resultReady = {
				completedAtEpochMs: event.completedAtEpochMs,
				drawUnitCount: event.drawUnitCount,
				objectVisualResourceCount: event.objectVisualResourceCount,
				transferByteLength: event.transferByteLength,
				transferCount: event.transferCount,
			};
			return;
		}

		if (event.kind !== "trace") {
			return;
		}
		request.traceEvents.push(event.event);
		if (request.traceEvents.length > MAX_STATIC_BAKER_TRACE_EVENTS) {
			request.traceEvents.splice(
				0,
				request.traceEvents.length - MAX_STATIC_BAKER_TRACE_EVENTS,
			);
		}
	}

	#createBoundaryDiagnostics(
		requestId: string,
	): StaticBakeWorkerBoundaryDiagnostics | null {
		const request = this.#requests.get(requestId);
		const resultReady = request?.resultReady;
		if (!request || !resultReady) {
			return null;
		}
		const resolvedAtEpochMs = Date.now();
		return {
			completedAtEpochMs: resultReady.completedAtEpochMs,
			deliveryMs: Math.max(
				0,
				resolvedAtEpochMs - resultReady.completedAtEpochMs,
			),
			drawUnitCount: resultReady.drawUnitCount,
			objectVisualResourceCount: resultReady.objectVisualResourceCount,
			resolvedAtEpochMs,
			submittedAtEpochMs: request.submittedAtEpochMs,
			transferByteLength: resultReady.transferByteLength,
			transferCount: resultReady.transferCount,
			waitMs:
				request.startedAtEpochMs === null
					? null
					: Math.max(
							0,
							resultReady.completedAtEpochMs - request.startedAtEpochMs,
						),
		};
	}

	#createJobSnapshot(
		poolSnapshot: WorkerPoolDiagnosticsSnapshot,
		requestId: string,
		stage: "queued" | "executing",
		currentNowMs: number,
	): StaticBakerDiagnosticsSnapshot["pendingJobs"][number] | null {
		const request = this.#requests.get(requestId);
		const poolJob =
			poolSnapshot.queuedJobs.find((job) => job.requestId === requestId) ??
			poolSnapshot.activeJobs.find((job) => job.requestId === requestId);
		if (!request || !poolJob) {
			return null;
		}

		return {
			ageMs: currentNowMs - poolJob.queuedAtMs,
			domain: request.input.domain,
			queuedAtMs: poolJob.queuedAtMs,
			requestId,
			revision: request.input.revision,
			scopeKey: request.input.task.scopeKey,
			stage,
			stageAgeMs: currentNowMs - poolJob.stageStartedAtMs,
			stageStartedAtMs: poolJob.stageStartedAtMs,
			taskId: request.input.task.taskId,
			traceEvents: request.traceEvents,
		};
	}
}
