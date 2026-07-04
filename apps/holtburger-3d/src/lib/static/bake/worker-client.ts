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
	readonly traceEvents: StaticBakerTraceEvent[];
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
		let requestId = "";
		const handle = this.#pool.submitHandle(input, {
			onProgress: (event) => this.#recordProgress(requestId, event),
		});
		requestId = handle.requestId;
		this.#requests.set(handle.requestId, {
			input,
			traceEvents: [],
		});
		return handle.result.finally(() => {
			this.#requests.delete(handle.requestId);
		});
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
		if (event.kind !== "trace") {
			return;
		}
		const request = this.#requests.get(requestId);
		if (!request) {
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
