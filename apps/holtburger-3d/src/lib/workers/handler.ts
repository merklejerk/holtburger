import type {
	WorkerErrorMessage,
	WorkerJobMessage,
	WorkerProgressMessage,
	WorkerResultMessage,
	WorkerServiceErrorMessage,
	WorkerServiceRequestMessage,
	WorkerServiceResponseMessage,
} from "./pool";

export type WorkerHandlerInputMessage<TInput, TServiceResponse = never> =
	| WorkerJobMessage<TInput>
	| {
			readonly kind: "cancel";
			readonly requestId: string;
	  }
	| WorkerServiceResponseMessage<TServiceResponse>
	| WorkerServiceErrorMessage;

export type WorkerHandlerOutputMessage<
	TOutput,
	TProgress,
	TServiceRequest = never,
> =
	| WorkerResultMessage<TOutput>
	| WorkerErrorMessage
	| WorkerProgressMessage<TProgress>
	| WorkerServiceRequestMessage<TServiceRequest>;

export interface WorkerHandlerPort<
	TInput,
	TOutput,
	TProgress,
	TServiceRequest = never,
	TServiceResponse = never,
> {
	postMessage(
		message: WorkerHandlerOutputMessage<TOutput, TProgress, TServiceRequest>,
		transfer?: readonly Transferable[],
	): void;
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<WorkerHandlerInputMessage<TInput, TServiceResponse>>,
		) => void,
	): void;
	removeEventListener?(
		type: "message",
		listener: (
			event: MessageEvent<WorkerHandlerInputMessage<TInput, TServiceResponse>>,
		) => void,
	): void;
}

export interface WorkerExecuteContext<
	TProgress,
	TServiceRequest = never,
	TServiceResponse = never,
> {
	readonly requestId: string;
	readonly signal: AbortSignal;
	report(event: TProgress, transfer?: readonly Transferable[]): void;
	requestService(request: TServiceRequest): Promise<TServiceResponse>;
}

export interface WorkerExecuteResult<TOutput> {
	readonly output: TOutput;
	readonly transfer?: readonly Transferable[];
}

export interface WorkerHandlerOptions<
	TInput,
	TOutput,
	TProgress = never,
	TServiceRequest = never,
	TServiceResponse = never,
> {
	readonly port: WorkerHandlerPort<
		TInput,
		TOutput,
		TProgress,
		TServiceRequest,
		TServiceResponse
	>;
	readonly execute: (
		input: TInput,
		context: WorkerExecuteContext<TProgress, TServiceRequest, TServiceResponse>,
	) => Promise<WorkerExecuteResult<TOutput>>;
}

export interface InstalledWorkerHandler {
	dispose(): void;
}

interface ActiveWorkerJob {
	readonly controller: AbortController;
	readonly pendingServices: Set<string>;
}

interface PendingWorkerServiceRequest<TServiceResponse> {
	readonly requestId: string;
	readonly resolve: (response: TServiceResponse) => void;
	readonly reject: (error: Error) => void;
}

export function installWorkerHandler<
	TInput,
	TOutput,
	TProgress = never,
	TServiceRequest = never,
	TServiceResponse = never,
>(
	options: WorkerHandlerOptions<
		TInput,
		TOutput,
		TProgress,
		TServiceRequest,
		TServiceResponse
	>,
): InstalledWorkerHandler {
	const activeJobs = new Map<string, ActiveWorkerJob>();
	const canceledBeforeStart = new Set<string>();
	const pendingServices = new Map<
		string,
		PendingWorkerServiceRequest<TServiceResponse>
	>();
	let nextServiceRequestIndex = 0;

	const listener = (
		event: MessageEvent<WorkerHandlerInputMessage<TInput, TServiceResponse>>,
	): void => {
		void handleMessage(event.data);
	};

	options.port.addEventListener("message", listener);

	return {
		dispose(): void {
			options.port.removeEventListener?.("message", listener);
			for (const job of activeJobs.values()) {
				job.controller.abort();
			}
			for (const service of pendingServices.values()) {
				service.reject(new Error("Worker handler was disposed."));
			}
			activeJobs.clear();
			pendingServices.clear();
			canceledBeforeStart.clear();
		},
	};

	async function handleMessage(
		message: WorkerHandlerInputMessage<TInput, TServiceResponse>,
	): Promise<void> {
		if (message.kind === "cancel") {
			cancelRequest(message.requestId);
			return;
		}
		if (message.kind === "service-response") {
			resolveServiceRequest(message);
			return;
		}
		if (message.kind === "service-error") {
			rejectServiceRequest(message);
			return;
		}

		if (canceledBeforeStart.delete(message.requestId)) {
			postCanceled(message.requestId);
			return;
		}
		if (activeJobs.has(message.requestId)) {
			throw new Error(
				`Worker job '${message.requestId}' is already active in this worker.`,
			);
		}

		const controller = new AbortController();
		const activeJob: ActiveWorkerJob = {
			controller,
			pendingServices: new Set(),
		};
		activeJobs.set(message.requestId, activeJob);
		const context: WorkerExecuteContext<
			TProgress,
			TServiceRequest,
			TServiceResponse
		> = {
			report: (event, transfer = []): void => {
				if (controller.signal.aborted) {
					return;
				}
				options.port.postMessage(
					{
						event,
						kind: "progress",
						requestId: message.requestId,
					},
					transfer,
				);
			},
			requestService: (request) =>
				requestService(message.requestId, activeJob, request),
			requestId: message.requestId,
			signal: controller.signal,
		};

		try {
			const result = await options.execute(message.input, context);
			activeJobs.delete(message.requestId);
			if (controller.signal.aborted) {
				postCanceled(message.requestId);
				return;
			}
			options.port.postMessage(
				{
					kind: "result",
					output: result.output,
					requestId: message.requestId,
				},
				result.transfer,
			);
		} catch (error: unknown) {
			activeJobs.delete(message.requestId);
			const normalizedError = controller.signal.aborted
				? new Error("Worker job was canceled.")
				: normalizeError(error);
			options.port.postMessage({
				kind: "error",
				message: normalizedError.message,
				requestId: message.requestId,
				stack: normalizedError.stack,
			});
		}
	}

	function cancelRequest(requestId: string): void {
		const activeJob = activeJobs.get(requestId);
		if (!activeJob) {
			canceledBeforeStart.add(requestId);
			return;
		}
		activeJob.controller.abort();
		for (const serviceRequestId of activeJob.pendingServices) {
			const pending = pendingServices.get(serviceRequestId);
			pending?.reject(new Error("Worker job was canceled."));
			pendingServices.delete(serviceRequestId);
		}
		activeJob.pendingServices.clear();
	}

	function postCanceled(requestId: string): void {
		options.port.postMessage({
			kind: "error",
			message: "Worker job was canceled.",
			requestId,
		});
	}

	function requestService(
		requestId: string,
		activeJob: ActiveWorkerJob,
		request: TServiceRequest,
	): Promise<TServiceResponse> {
		if (activeJob.controller.signal.aborted) {
			return Promise.reject(new Error("Worker job was canceled."));
		}

		const serviceRequestId = `${requestId}:service:${nextServiceRequestIndex}`;
		nextServiceRequestIndex += 1;
		activeJob.pendingServices.add(serviceRequestId);

		return new Promise((resolve, reject) => {
			pendingServices.set(serviceRequestId, {
				reject,
				requestId,
				resolve,
			});
			options.port.postMessage({
				kind: "service-request",
				request,
				requestId,
				serviceRequestId,
			});
		});
	}

	function resolveServiceRequest(
		message: WorkerServiceResponseMessage<TServiceResponse>,
	): void {
		const pending = pendingServices.get(message.serviceRequestId);
		if (!pending) {
			return;
		}
		pendingServices.delete(message.serviceRequestId);
		activeJobs
			.get(pending.requestId)
			?.pendingServices.delete(message.serviceRequestId);
		pending.resolve(message.response);
	}

	function rejectServiceRequest(message: WorkerServiceErrorMessage): void {
		const pending = pendingServices.get(message.serviceRequestId);
		if (!pending) {
			return;
		}
		pendingServices.delete(message.serviceRequestId);
		activeJobs
			.get(pending.requestId)
			?.pendingServices.delete(message.serviceRequestId);
		pending.reject(new Error(message.message));
	}
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}
