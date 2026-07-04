export interface WorkerJobDescription {
	readonly label?: string;
	readonly taskId?: string;
}

export interface WorkerJobMessage<TInput> {
	readonly kind: "job";
	readonly requestId: string;
	readonly input: TInput;
}

export interface WorkerCancelMessage {
	readonly kind: "cancel";
	readonly requestId: string;
}

export interface WorkerResultMessage<TOutput> {
	readonly kind: "result";
	readonly requestId: string;
	readonly output: TOutput;
}

export interface WorkerErrorMessage {
	readonly kind: "error";
	readonly requestId: string;
	readonly message: string;
	readonly stack?: string;
}

export interface WorkerProgressMessage<TProgress> {
	readonly kind: "progress";
	readonly requestId: string;
	readonly event: TProgress;
}

export interface WorkerServiceRequestMessage<TServiceRequest> {
	readonly kind: "service-request";
	readonly requestId: string;
	readonly serviceRequestId: string;
	readonly request: TServiceRequest;
}

export interface WorkerServiceResponseMessage<TServiceResponse> {
	readonly kind: "service-response";
	readonly serviceRequestId: string;
	readonly response: TServiceResponse;
}

export interface WorkerServiceErrorMessage {
	readonly kind: "service-error";
	readonly serviceRequestId: string;
	readonly message: string;
}

export type WorkerPoolRequestMessage<TInput, TServiceResponse = never> =
	| WorkerJobMessage<TInput>
	| WorkerCancelMessage
	| WorkerServiceResponseMessage<TServiceResponse>
	| WorkerServiceErrorMessage;

export type WorkerPoolResponseMessage<
	TOutput,
	TProgress,
	TServiceRequest = never,
> =
	| WorkerResultMessage<TOutput>
	| WorkerErrorMessage
	| WorkerProgressMessage<TProgress>
	| WorkerServiceRequestMessage<TServiceRequest>;

export interface WorkerMessagePort<TSend, TReceive> {
	postMessage(message: TSend, transfer?: readonly Transferable[]): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<TReceive>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<TReceive>) => void,
	): void;
	terminate?(): void;
}

export interface WorkerSubmitOptions<TProgress> {
	readonly priority?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (event: TProgress) => void;
	readonly description?: WorkerJobDescription;
}

export interface WorkerJobHandle<TOutput> {
	readonly requestId: string;
	readonly result: Promise<TOutput>;
	cancel(): void;
}

export type WorkerDispatchMode = "idle-workers" | "pipelined-workers";

export interface WorkerServiceHandlerResult<TServiceResponse> {
	readonly response: TServiceResponse;
	readonly transfer?: readonly Transferable[];
}

export type WorkerServiceHandler<TServiceRequest, TServiceResponse> = (
	request: TServiceRequest,
) => Promise<WorkerServiceHandlerResult<TServiceResponse>>;

export interface WorkerPoolOptions<
	TInput,
	TOutput,
	TProgress = never,
	TServiceRequest = never,
	TServiceResponse = never,
> {
	readonly createWorker: () => WorkerMessagePort<
		WorkerPoolRequestMessage<TInput, TServiceResponse>,
		WorkerPoolResponseMessage<TOutput, TProgress, TServiceRequest>
	>;
	readonly size: number;
	readonly transferInput?: (input: TInput) => readonly Transferable[];
	readonly describe?: (input: TInput) => WorkerJobDescription;
	readonly dispatchMode?: WorkerDispatchMode;
	readonly requestIdPrefix?: string;
	readonly progressEventLimit?: number;
	readonly serviceHandler?: WorkerServiceHandler<
		TServiceRequest,
		TServiceResponse
	>;
}

export interface WorkerPoolJobDiagnostics {
	readonly requestId: string;
	readonly stage: "queued" | "running";
	readonly priority: number;
	readonly queuedAtMs: number;
	readonly stageStartedAtMs: number;
	readonly description?: WorkerJobDescription;
	readonly cancellationRequested: boolean;
}

export interface WorkerPoolProgressDiagnostics {
	readonly requestId: string;
	readonly event: unknown;
}

export interface WorkerPoolDiagnosticsSnapshot {
	readonly workerCount: number;
	readonly queuedJobs: readonly WorkerPoolJobDiagnostics[];
	readonly activeJobs: readonly WorkerPoolJobDiagnostics[];
	readonly progressEvents: readonly WorkerPoolProgressDiagnostics[];
	readonly submittedJobs: number;
	readonly completedJobs: number;
	readonly failedJobs: number;
	readonly canceledJobs: number;
	readonly disposed: boolean;
}

interface QueuedWorkerJob<TInput, TOutput, TProgress> {
	readonly requestId: string;
	readonly input: TInput;
	readonly priority: number;
	readonly sequence: number;
	readonly queuedAtMs: number;
	readonly description?: WorkerJobDescription;
	readonly signal?: AbortSignal;
	readonly onAbort: () => void;
	readonly onProgress?: (event: TProgress) => void;
	readonly resolve: (output: TOutput) => void;
	readonly reject: (error: Error) => void;
	cancellationRequested: boolean;
	stageStartedAtMs: number;
	workerIndex?: number;
}

interface WorkerSlot<
	TInput,
	TOutput,
	TProgress,
	TServiceRequest,
	TServiceResponse,
> {
	readonly index: number;
	readonly port: WorkerMessagePort<
		WorkerPoolRequestMessage<TInput, TServiceResponse>,
		WorkerPoolResponseMessage<TOutput, TProgress, TServiceRequest>
	>;
	readonly listener: (
		event: MessageEvent<
			WorkerPoolResponseMessage<TOutput, TProgress, TServiceRequest>
		>,
	) => void;
	activeRequestId?: string;
}

export class StandardWorkerPool<
	TInput,
	TOutput,
	TProgress = never,
	TServiceRequest = never,
	TServiceResponse = never,
> {
	readonly #workers: WorkerSlot<
		TInput,
		TOutput,
		TProgress,
		TServiceRequest,
		TServiceResponse
	>[];
	readonly #queuedJobs: QueuedWorkerJob<TInput, TOutput, TProgress>[] = [];
	readonly #activeJobs = new Map<
		string,
		QueuedWorkerJob<TInput, TOutput, TProgress>
	>();
	readonly #settledRequestIds = new Set<string>();
	readonly #transferInput?: (input: TInput) => readonly Transferable[];
	readonly #describe?: (input: TInput) => WorkerJobDescription;
	readonly #serviceHandler?: WorkerServiceHandler<
		TServiceRequest,
		TServiceResponse
	>;
	readonly #requestIdPrefix: string;
	readonly #progressEventLimit: number;
	#nextRequestNumber = 0;
	#nextSequence = 0;
	#submittedJobs = 0;
	#completedJobs = 0;
	#failedJobs = 0;
	#canceledJobs = 0;
	#disposed = false;
	readonly #progressEvents: WorkerPoolProgressDiagnostics[] = [];

	constructor(
		options: WorkerPoolOptions<
			TInput,
			TOutput,
			TProgress,
			TServiceRequest,
			TServiceResponse
		>,
	) {
		if (options.size < 1) {
			throw new Error("StandardWorkerPool requires at least one worker.");
		}
		if (options.dispatchMode === "pipelined-workers") {
			throw new Error(
				"StandardWorkerPool does not implement pipelined worker dispatch yet.",
			);
		}

		this.#transferInput = options.transferInput;
		this.#describe = options.describe;
		this.#serviceHandler = options.serviceHandler;
		this.#requestIdPrefix = options.requestIdPrefix ?? "worker-job";
		this.#progressEventLimit = options.progressEventLimit ?? 50;
		this.#workers = Array.from({ length: options.size }, (_, index) => {
			const port = options.createWorker();
			const listener = (
				event: MessageEvent<
					WorkerPoolResponseMessage<TOutput, TProgress, TServiceRequest>
				>,
			): void => {
				this.#handleWorkerMessage(index, event.data);
			};
			port.addEventListener("message", listener);
			return { index, listener, port };
		});
	}

	submit(
		input: TInput,
		options: WorkerSubmitOptions<TProgress> = {},
	): Promise<TOutput> {
		return this.submitHandle(input, options).result;
	}

	submitHandle(
		input: TInput,
		options: WorkerSubmitOptions<TProgress> = {},
	): WorkerJobHandle<TOutput> {
		if (this.#disposed) {
			return createRejectedHandle(
				this.#createRequestId(),
				new Error("StandardWorkerPool has been disposed."),
			);
		}

		const requestId = this.#createRequestId();
		const description = options.description ?? this.#describe?.(input);
		let job: QueuedWorkerJob<TInput, TOutput, TProgress>;
		const result = new Promise<TOutput>((resolve, reject) => {
			const queuedAtMs = performance.now();
			const onAbort = (): void => {
				this.#cancelJob(requestId, new Error("Worker job was canceled."));
			};
			job = {
				cancellationRequested: false,
				description,
				input,
				onAbort,
				onProgress: options.onProgress,
				priority: options.priority ?? 0,
				queuedAtMs,
				reject,
				requestId,
				resolve,
				sequence: this.#nextSequence,
				signal: options.signal,
				stageStartedAtMs: queuedAtMs,
			};
		});

		const queuedJob = job!;
		this.#nextSequence += 1;
		this.#submittedJobs += 1;

		if (options.signal?.aborted === true) {
			this.#settleCanceledQueuedJob(
				queuedJob,
				new Error("Worker job was canceled."),
			);
			return {
				cancel: () => undefined,
				requestId,
				result,
			};
		}

		options.signal?.addEventListener("abort", queuedJob.onAbort, {
			once: true,
		});
		this.#queuedJobs.push(queuedJob);
		this.#sortQueue();
		this.#dispatchQueuedJobs();

		return {
			cancel: (): void => {
				this.#cancelJob(requestId, new Error("Worker job was canceled."));
			},
			requestId,
			result,
		};
	}

	createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot {
		return {
			activeJobs: Array.from(this.#activeJobs.values(), (job) =>
				createJobDiagnostics(job, "running"),
			),
			canceledJobs: this.#canceledJobs,
			completedJobs: this.#completedJobs,
			disposed: this.#disposed,
			failedJobs: this.#failedJobs,
			progressEvents: [...this.#progressEvents],
			queuedJobs: this.#queuedJobs.map((job) =>
				createJobDiagnostics(job, "queued"),
			),
			submittedJobs: this.#submittedJobs,
			workerCount: this.#workers.length,
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}
		this.#disposed = true;

		const disposalError = new Error("StandardWorkerPool has been disposed.");
		for (const job of this.#queuedJobs.splice(0)) {
			this.#settledRequestIds.add(job.requestId);
			job.signal?.removeEventListener("abort", job.onAbort);
			job.reject(disposalError);
		}
		for (const job of this.#activeJobs.values()) {
			this.#settledRequestIds.add(job.requestId);
			job.signal?.removeEventListener("abort", job.onAbort);
			job.reject(disposalError);
		}
		this.#activeJobs.clear();

		for (const worker of this.#workers) {
			worker.port.removeEventListener("message", worker.listener);
			worker.port.terminate?.();
			worker.activeRequestId = undefined;
		}
	}

	#dispatchQueuedJobs(): void {
		if (this.#disposed) {
			return;
		}

		for (const worker of this.#workers) {
			if (worker.activeRequestId !== undefined) {
				continue;
			}
			const job = this.#queuedJobs.shift();
			if (!job) {
				return;
			}

			job.workerIndex = worker.index;
			job.stageStartedAtMs = performance.now();
			worker.activeRequestId = job.requestId;
			this.#activeJobs.set(job.requestId, job);
			worker.port.postMessage(
				{
					input: job.input,
					kind: "job",
					requestId: job.requestId,
				},
				this.#transferInput?.(job.input),
			);
		}
	}

	#handleWorkerMessage(
		workerIndex: number,
		message: WorkerPoolResponseMessage<TOutput, TProgress, TServiceRequest>,
	): void {
		if (this.#disposed || this.#settledRequestIds.has(message.requestId)) {
			return;
		}

		const job = this.#activeJobs.get(message.requestId);
		if (!job) {
			return;
		}

		if (message.kind === "progress") {
			this.#recordProgress(message.requestId, message.event);
			job.onProgress?.(message.event);
			return;
		}

		if (message.kind === "service-request") {
			this.#handleServiceRequest(workerIndex, message);
			return;
		}

		this.#finishActiveJob(workerIndex, job);
		if (message.kind === "result") {
			this.#completedJobs += 1;
			job.resolve(message.output);
		} else {
			this.#failedJobs += 1;
			job.reject(createWorkerError(message));
		}
		this.#dispatchQueuedJobs();
	}

	#handleServiceRequest(
		workerIndex: number,
		message: WorkerServiceRequestMessage<TServiceRequest>,
	): void {
		const worker = this.#workers[workerIndex];
		if (!worker || this.#settledRequestIds.has(message.requestId)) {
			return;
		}
		if (!this.#serviceHandler) {
			worker.port.postMessage({
				kind: "service-error",
				message: "Worker service request has no handler.",
				serviceRequestId: message.serviceRequestId,
			});
			return;
		}

		void this.#serviceHandler(message.request).then(
			(result) => {
				if (
					this.#disposed ||
					this.#settledRequestIds.has(message.requestId) ||
					!this.#activeJobs.has(message.requestId)
				) {
					return;
				}
				worker.port.postMessage(
					{
						kind: "service-response",
						response: result.response,
						serviceRequestId: message.serviceRequestId,
					},
					result.transfer,
				);
			},
			(error: unknown) => {
				if (
					this.#disposed ||
					this.#settledRequestIds.has(message.requestId) ||
					!this.#activeJobs.has(message.requestId)
				) {
					return;
				}
				worker.port.postMessage({
					kind: "service-error",
					message: error instanceof Error ? error.message : String(error),
					serviceRequestId: message.serviceRequestId,
				});
			},
		);
	}

	#finishActiveJob(
		workerIndex: number,
		job: QueuedWorkerJob<TInput, TOutput, TProgress>,
	): void {
		this.#activeJobs.delete(job.requestId);
		this.#settledRequestIds.add(job.requestId);
		job.signal?.removeEventListener("abort", job.onAbort);
		const worker = this.#workers[workerIndex];
		if (worker?.activeRequestId === job.requestId) {
			worker.activeRequestId = undefined;
		}
	}

	#cancelJob(requestId: string, error: Error): void {
		const queuedIndex = this.#queuedJobs.findIndex(
			(job) => job.requestId === requestId,
		);
		if (queuedIndex >= 0) {
			const [job] = this.#queuedJobs.splice(queuedIndex, 1);
			if (job) {
				this.#settleCanceledQueuedJob(job, error);
			}
			return;
		}

		const activeJob = this.#activeJobs.get(requestId);
		if (!activeJob) {
			return;
		}
		activeJob.cancellationRequested = true;
		const workerIndex = activeJob.workerIndex;
		this.#activeJobs.delete(requestId);
		this.#settledRequestIds.add(requestId);
		activeJob.signal?.removeEventListener("abort", activeJob.onAbort);
		this.#canceledJobs += 1;
		activeJob.reject(error);

		if (workerIndex !== undefined) {
			const worker = this.#workers[workerIndex];
			if (worker) {
				worker.port.postMessage({ kind: "cancel", requestId });
				worker.activeRequestId = undefined;
			}
		}
		this.#dispatchQueuedJobs();
	}

	#settleCanceledQueuedJob(
		job: QueuedWorkerJob<TInput, TOutput, TProgress>,
		error: Error,
	): void {
		job.cancellationRequested = true;
		this.#settledRequestIds.add(job.requestId);
		job.signal?.removeEventListener("abort", job.onAbort);
		this.#canceledJobs += 1;
		job.reject(error);
	}

	#sortQueue(): void {
		this.#queuedJobs.sort((left, right) => {
			const priorityDelta = right.priority - left.priority;
			return priorityDelta === 0
				? left.sequence - right.sequence
				: priorityDelta;
		});
	}

	#createRequestId(): string {
		const requestId = `${this.#requestIdPrefix}:${this.#nextRequestNumber}`;
		this.#nextRequestNumber += 1;
		return requestId;
	}

	#recordProgress(requestId: string, event: TProgress): void {
		this.#progressEvents.push({ event, requestId });
		if (this.#progressEvents.length > this.#progressEventLimit) {
			this.#progressEvents.splice(
				0,
				this.#progressEvents.length - this.#progressEventLimit,
			);
		}
	}
}

function createRejectedHandle<TOutput>(
	requestId: string,
	error: Error,
): WorkerJobHandle<TOutput> {
	return {
		cancel: () => undefined,
		requestId,
		result: Promise.reject(error),
	};
}

function createJobDiagnostics<TInput, TOutput, TProgress>(
	job: QueuedWorkerJob<TInput, TOutput, TProgress>,
	stage: "queued" | "running",
): WorkerPoolJobDiagnostics {
	return {
		cancellationRequested: job.cancellationRequested,
		description: job.description,
		priority: job.priority,
		queuedAtMs: job.queuedAtMs,
		requestId: job.requestId,
		stage,
		stageStartedAtMs: job.stageStartedAtMs,
	};
}

function createWorkerError(message: WorkerErrorMessage): Error {
	const error = new Error(message.message);
	if (message.stack !== undefined) {
		error.stack = message.stack;
	}
	return error;
}
