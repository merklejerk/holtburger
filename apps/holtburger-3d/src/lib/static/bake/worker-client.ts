import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticBakerDiagnosticsSnapshot,
	StaticBakerTraceEvent,
} from "../contracts";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerThreadMessage,
} from "./protocol";

interface PendingBakeRequest {
	readonly input: StaticBakeJobInput;
	readonly queuedAtMs: number;
	readonly resolve: (result: StaticBakeJobResult) => void;
	readonly reject: (error: Error) => void;
	stage: "queued" | "executing";
	stageStartedAtMs: number;
	traceEvents: StaticBakerTraceEvent[];
}

const MAX_STATIC_BAKER_TRACE_EVENTS = 64;

interface StaticBakeWorkerClientOptions {
	readonly disposePort?: () => void;
}

export class StaticBakeWorkerClient implements StaticBaker {
	readonly #port: StaticBakeWorkerPort;
	readonly #disposePort: (() => void) | null;
	readonly #pending = new Map<string, PendingBakeRequest>();
	#nextRequestIndex = 0;
	#disposed = false;
	readonly #onMessage = (
		event: MessageEvent<StaticBakeWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(
		port: StaticBakeWorkerPort,
		options: StaticBakeWorkerClientOptions = {},
	) {
		this.#port = port;
		this.#disposePort = options.disposePort ?? null;
		this.#port.addEventListener("message", this.#onMessage);
	}

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("Static bake worker client was disposed."),
			);
		}

		const requestId = `bake-job:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			const queuedAtMs = nowMs();
			this.#pending.set(requestId, {
				input,
				queuedAtMs,
				reject,
				resolve,
				stage: "queued",
				stageStartedAtMs: queuedAtMs,
				traceEvents: [],
			});
			this.#port.postMessage({
				input,
				kind: "bake-static-job",
				requestId,
			});
		});
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static bake worker client was disposed."));
		}
		this.#pending.clear();
		this.#disposePort?.();
	}

	createDiagnosticsSnapshot(): StaticBakerDiagnosticsSnapshot {
		const currentNowMs = nowMs();
		return {
			kind: "static-baker",
			pendingJobs: Array.from(this.#pending.entries()).map(
				([requestId, pending]) => ({
					ageMs: currentNowMs - pending.queuedAtMs,
					domain: pending.input.domain,
					queuedAtMs: pending.queuedAtMs,
					requestId,
					revision: pending.input.revision,
					scopeKey: pending.input.task.scopeKey,
					stage: pending.stage,
					stageAgeMs: currentNowMs - pending.stageStartedAtMs,
					stageStartedAtMs: pending.stageStartedAtMs,
					taskId: pending.input.task.taskId,
					traceEvents: pending.traceEvents,
				}),
			),
			workerCount: 1,
		};
	}

	#handleResponse(response: StaticBakeWorkerThreadMessage): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		if (response.kind === "static-job-bake-started") {
			pending.stage = "executing";
			pending.stageStartedAtMs = nowMs();
			return;
		}

		if (response.kind === "static-job-bake-trace") {
			pending.traceEvents.push(response.event);
			if (pending.traceEvents.length > MAX_STATIC_BAKER_TRACE_EVENTS) {
				pending.traceEvents.splice(
					0,
					pending.traceEvents.length - MAX_STATIC_BAKER_TRACE_EVENTS,
				);
			}
			return;
		}

		if (response.kind === "static-job-bake-failed") {
			this.#pending.delete(response.requestId);
			pending.reject(new Error(response.message));
			return;
		}

		this.#pending.delete(response.requestId);
		pending.resolve(response.result);
	}
}

export class WorkerPoolStaticBaker implements StaticBaker {
	readonly #bakers: readonly StaticBaker[];
	readonly #activeBakerIndexes = new Set<number>();
	readonly #queuedRequests: PoolQueuedBakeRequest[] = [];
	#nextBakerIndex = 0;
	#nextPoolRequestIndex = 0;
	#disposed = false;

	constructor(bakers: readonly StaticBaker[]) {
		if (bakers.length === 0) {
			throw new Error("WorkerPoolStaticBaker requires at least one baker.");
		}

		this.#bakers = bakers;
	}

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolStaticBaker has been disposed."),
			);
		}

		return new Promise((resolve, reject) => {
			const queuedAtMs = nowMs();
			this.#queuedRequests.push({
				input,
				queuedAtMs,
				reject,
				requestId: `pool-job:${this.#nextPoolRequestIndex}`,
				resolve,
			});
			this.#nextPoolRequestIndex += 1;
			this.#dispatchQueuedRequests();
		});
	}

	#dispatchQueuedRequests(): void {
		while (this.#queuedRequests.length > 0) {
			const bakerIndex = this.#selectIdleBakerIndex();
			if (bakerIndex === null) {
				return;
			}
			const request = this.#queuedRequests.shift();
			const baker = this.#bakers[bakerIndex];
			if (!request || !baker) {
				return;
			}
			this.#activeBakerIndexes.add(bakerIndex);
			this.#nextBakerIndex = (bakerIndex + 1) % this.#bakers.length;
			void baker.bake(request.input).then(
				(result) => {
					this.#activeBakerIndexes.delete(bakerIndex);
					this.#dispatchQueuedRequests();
					request.resolve(result);
				},
				(error: unknown) => {
					this.#activeBakerIndexes.delete(bakerIndex);
					this.#dispatchQueuedRequests();
					request.reject(
						error instanceof Error ? error : new Error(String(error)),
					);
				},
			);
		}
	}

	#selectIdleBakerIndex(): number | null {
		for (let offset = 0; offset < this.#bakers.length; offset += 1) {
			const index = (this.#nextBakerIndex + offset) % this.#bakers.length;
			if (!this.#activeBakerIndexes.has(index)) {
				return index;
			}
		}
		return null;
	}

	createDiagnosticsSnapshot(): StaticBakerDiagnosticsSnapshot {
		const currentNowMs = nowMs();
		return {
			kind: "static-baker",
			pendingJobs: [
				...this.#queuedRequests.map((request) => ({
					ageMs: currentNowMs - request.queuedAtMs,
					domain: request.input.domain,
					queuedAtMs: request.queuedAtMs,
					requestId: request.requestId,
					revision: request.input.revision,
					scopeKey: request.input.task.scopeKey,
					stage: "queued" as const,
					stageAgeMs: currentNowMs - request.queuedAtMs,
					stageStartedAtMs: request.queuedAtMs,
					taskId: request.input.task.taskId,
					traceEvents: [],
				})),
				...this.#bakers.flatMap((baker, workerIndex) =>
					(baker.createDiagnosticsSnapshot?.().pendingJobs ?? []).map(
						(job) => ({
							...job,
							requestId: `worker:${workerIndex}:${job.requestId}`,
						}),
					),
				),
			],
			workerCount: this.#bakers.length,
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		for (const request of this.#queuedRequests.splice(0)) {
			request.reject(new Error("WorkerPoolStaticBaker has been disposed."));
		}
		for (const baker of this.#bakers) {
			disposeIfAvailable(baker);
		}
	}
}

interface PoolQueuedBakeRequest {
	readonly input: StaticBakeJobInput;
	readonly queuedAtMs: number;
	readonly reject: (error: Error) => void;
	readonly requestId: string;
	readonly resolve: (result: StaticBakeJobResult) => void;
}

function nowMs(): number {
	return performance.now();
}

function disposeIfAvailable(value: unknown): void {
	if (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	) {
		value.dispose();
	}
}
