import type {
	RenderResourceWorkerEchoJob,
	RenderResourceWorkerEchoResult,
	RenderResourceWorkerJob,
	RenderResourceWorkerJobResult,
	RenderResourceWorkerRequestMessage,
	RenderResourceWorkerResponseMessage,
} from "../../workers/render-resource-worker";

export interface RenderResourceWorkerLike {
	onmessage:
		| ((event: MessageEvent<RenderResourceWorkerResponseMessage>) => void)
		| null;
	onerror: ((event: Event | ErrorEvent) => void) | null;
	postMessage(
		message: RenderResourceWorkerRequestMessage,
		transferables?: Transferable[],
	): void;
	terminate(): void;
}

type PendingRenderResourceWorkerRequest = {
	resolve: (result: RenderResourceWorkerJobResult) => void;
	reject: (error: Error) => void;
};

export class RenderResourceWorkerClient {
	private readonly worker: RenderResourceWorkerLike;

	private readonly pendingRequests = new Map<
		string,
		PendingRenderResourceWorkerRequest
	>();

	private nextRequestSequence = 1;

	private disposed = false;

	constructor(workerFactory: () => RenderResourceWorkerLike = createWorker) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			this.handleWorkerMessage(event.data);
		};
		this.worker.onerror = (event) => {
			const errorMessage =
				event instanceof ErrorEvent
					? event.message
					: "Render resource worker failed before work completed.";
			this.rejectAllPending(new Error(errorMessage));
		};
	}

	runEchoJob(
		job: RenderResourceWorkerEchoJob,
		transferables: readonly Transferable[] = [],
	): Promise<RenderResourceWorkerEchoResult> {
		return this.runJob(job, transferables).then((result) => {
			if (result.type !== "echo") {
				throw new Error(
					`Render resource worker returned ${result.type} for echo job.`,
				);
			}
			return result;
		});
	}

	runJob(
		job: RenderResourceWorkerJob,
		transferables: readonly Transferable[] = [],
	): Promise<RenderResourceWorkerJobResult> {
		this.throwIfDisposed();

		const requestId = `render-resource-${this.nextRequestSequence++}`;
		return new Promise<RenderResourceWorkerJobResult>((resolve, reject) => {
			this.pendingRequests.set(requestId, { resolve, reject });
			try {
				this.worker.postMessage(
					{
						type: "run-job",
						requestId,
						job,
					},
					[...transferables],
				);
			} catch (error) {
				this.pendingRequests.delete(requestId);
				reject(toError(error));
			}
		});
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.worker.terminate();
		this.rejectAllPending(
			new Error("Render resource worker was disposed before work completed."),
		);
	}

	private handleWorkerMessage(
		message: RenderResourceWorkerResponseMessage,
	): void {
		if (this.disposed) {
			return;
		}

		const pending = this.pendingRequests.get(message.requestId);
		if (!pending) {
			return;
		}

		this.pendingRequests.delete(message.requestId);
		if (message.type === "job-complete") {
			pending.resolve(message.result);
			return;
		}

		pending.reject(new Error(message.message));
	}

	private rejectAllPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Render resource worker was disposed.");
		}
	}
}

function createWorker(): RenderResourceWorkerLike {
	return new Worker(
		new URL("../../workers/render-resource-worker.ts", import.meta.url),
		{
			type: "module",
		},
	) as unknown as RenderResourceWorkerLike;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
