import type {
	WorkerErrorMessage,
	WorkerJobMessage,
	WorkerProgressMessage,
	WorkerResultMessage,
} from "./pool";

export type WorkerHandlerInputMessage<TInput> =
	| WorkerJobMessage<TInput>
	| {
			readonly kind: "cancel";
			readonly requestId: string;
	  };

export type WorkerHandlerOutputMessage<TOutput, TProgress> =
	| WorkerResultMessage<TOutput>
	| WorkerErrorMessage
	| WorkerProgressMessage<TProgress>;

export interface WorkerHandlerPort<TInput, TOutput, TProgress> {
	postMessage(
		message: WorkerHandlerOutputMessage<TOutput, TProgress>,
		transfer?: readonly Transferable[],
	): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<WorkerHandlerInputMessage<TInput>>) => void,
	): void;
	removeEventListener?(
		type: "message",
		listener: (event: MessageEvent<WorkerHandlerInputMessage<TInput>>) => void,
	): void;
}

export interface WorkerExecuteContext<TProgress> {
	readonly requestId: string;
	readonly signal: AbortSignal;
	report(event: TProgress, transfer?: readonly Transferable[]): void;
}

export interface WorkerExecuteResult<TOutput> {
	readonly output: TOutput;
	readonly transfer?: readonly Transferable[];
}

export interface WorkerHandlerOptions<TInput, TOutput, TProgress = never> {
	readonly port: WorkerHandlerPort<TInput, TOutput, TProgress>;
	readonly execute: (
		input: TInput,
		context: WorkerExecuteContext<TProgress>,
	) => Promise<WorkerExecuteResult<TOutput>>;
}

export interface InstalledWorkerHandler {
	dispose(): void;
}

interface ActiveWorkerJob {
	readonly controller: AbortController;
}

export function installWorkerHandler<TInput, TOutput, TProgress = never>(
	options: WorkerHandlerOptions<TInput, TOutput, TProgress>,
): InstalledWorkerHandler {
	const activeJobs = new Map<string, ActiveWorkerJob>();
	const canceledBeforeStart = new Set<string>();

	const listener = (
		event: MessageEvent<WorkerHandlerInputMessage<TInput>>,
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
			activeJobs.clear();
			canceledBeforeStart.clear();
		},
	};

	async function handleMessage(
		message: WorkerHandlerInputMessage<TInput>,
	): Promise<void> {
		if (message.kind === "cancel") {
			cancelRequest(message.requestId);
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
		activeJobs.set(message.requestId, { controller });
		const context: WorkerExecuteContext<TProgress> = {
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
	}

	function postCanceled(requestId: string): void {
		options.port.postMessage({
			kind: "error",
			message: "Worker job was canceled.",
			requestId,
		});
	}
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}
