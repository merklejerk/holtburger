import { describe, expect, it } from "vitest";
import {
	StandardWorkerPool,
	type WorkerMessagePort,
	type WorkerPoolRequestMessage,
	type WorkerPoolResponseMessage,
} from "./pool";

interface EchoInput {
	readonly value: string;
	readonly bytes?: Uint8Array;
}

interface EchoOutput {
	readonly value: string;
}

interface EchoProgress {
	readonly phase: string;
}

type EchoRequest = WorkerPoolRequestMessage<EchoInput>;
type EchoResponse = WorkerPoolResponseMessage<EchoOutput, EchoProgress>;

describe("standard worker pool", () => {
	it("submits typed input and resolves typed output", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory);
		const result = pool.submit({ value: "terrain" });

		expect(factory.workers).toHaveLength(1);
		expect(factory.workers[0]?.messages).toEqual([
			{
				input: { value: "terrain" },
				kind: "job",
				requestId: "test-worker:0",
			},
		]);

		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "packed" },
			requestId: "test-worker:0",
		});

		await expect(result).resolves.toEqual({ value: "packed" });
	});

	it("rejects worker failures with the normalized worker error", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory);
		const result = pool.submit({ value: "bad" });

		factory.workers[0]?.emit({
			kind: "error",
			message: "source does not fit",
			requestId: "test-worker:0",
			stack: "worker stack",
		});

		await expect(result).rejects.toThrow("source does not fit");
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			failedJobs: 1,
		});
	});

	it("rejects pending work on dispose and prevents future submission", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory, 2);
		const running = pool.submit({ value: "running" });
		const queued = pool.submit({ value: "queued" });
		const blocked = pool.submit({ value: "blocked" });

		pool.dispose();

		await expect(running).rejects.toThrow(
			"StandardWorkerPool has been disposed.",
		);
		await expect(queued).rejects.toThrow(
			"StandardWorkerPool has been disposed.",
		);
		await expect(blocked).rejects.toThrow(
			"StandardWorkerPool has been disposed.",
		);
		expect(factory.workers.every((worker) => worker.terminated)).toBe(true);
		await expect(pool.submit({ value: "late" })).rejects.toThrow(
			"StandardWorkerPool has been disposed.",
		);
	});

	it("drops late responses after canceling a running job", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory);
		const first = pool.submitHandle({ value: "first" });

		first.cancel();

		expect(factory.workers[0]?.messages.at(-1)).toEqual({
			kind: "cancel",
			requestId: "test-worker:0",
		});
		await expect(first.result).rejects.toThrow("Worker job was canceled.");

		const second = pool.submit({ value: "second" });
		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "late first" },
			requestId: "test-worker:0",
		});
		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "second output" },
			requestId: "test-worker:1",
		});

		await expect(second).resolves.toEqual({ value: "second output" });
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			canceledJobs: 1,
			completedJobs: 1,
		});
	});

	it("cancels queued jobs without posting them to a worker", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory);
		const running = pool.submit({ value: "running" });
		const queued = pool.submitHandle({ value: "queued" });

		queued.cancel();

		await expect(queued.result).rejects.toThrow("Worker job was canceled.");
		expect(factory.workers[0]?.messages).toHaveLength(1);
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			canceledJobs: 1,
			queuedJobs: [],
		});

		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "running output" },
			requestId: "test-worker:0",
		});
		await expect(running).resolves.toEqual({ value: "running output" });
	});

	it("wires abort signals into queued and running cancellation", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory);
		const runningController = new AbortController();
		const queuedController = new AbortController();
		const running = pool.submit(
			{ value: "running" },
			{
				signal: runningController.signal,
			},
		);
		const queued = pool.submit(
			{ value: "queued" },
			{
				signal: queuedController.signal,
			},
		);

		queuedController.abort();
		runningController.abort();

		await expect(queued).rejects.toThrow("Worker job was canceled.");
		await expect(running).rejects.toThrow("Worker job was canceled.");
		expect(factory.workers[0]?.messages).toEqual([
			{
				input: { value: "running" },
				kind: "job",
				requestId: "test-worker:0",
			},
			{
				kind: "cancel",
				requestId: "test-worker:0",
			},
		]);
	});

	it("creates workers through the injected factory", () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory, 3);

		expect(factory.workers).toHaveLength(3);
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			workerCount: 3,
		});
	});

	it("reports progress through callbacks and diagnostics", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = new StandardWorkerPool<EchoInput, EchoOutput, EchoProgress>({
			createWorker: () => factory.createWorker(),
			progressEventLimit: 1,
			requestIdPrefix: "test-worker",
			size: 1,
		});
		const progressEvents: EchoProgress[] = [];
		const result = pool.submit(
			{ value: "traceable" },
			{ onProgress: (event) => progressEvents.push(event) },
		);

		factory.workers[0]?.emit({
			event: { phase: "started" },
			kind: "progress",
			requestId: "test-worker:0",
		});
		factory.workers[0]?.emit({
			event: { phase: "baking" },
			kind: "progress",
			requestId: "test-worker:0",
		});
		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "done" },
			requestId: "test-worker:0",
		});

		await expect(result).resolves.toEqual({ value: "done" });
		expect(progressEvents).toEqual([{ phase: "started" }, { phase: "baking" }]);
		expect(pool.createDiagnosticsSnapshot().progressEvents).toEqual([
			{
				event: { phase: "baking" },
				requestId: "test-worker:0",
			},
		]);
	});

	it("dispatches only to idle workers from a central priority queue", async () => {
		const factory = new FixtureWorkerFactory();
		const pool = createPool(factory, 2);
		const first = pool.submit({ value: "first" });
		const second = pool.submit({ value: "second" });
		const lowPriority = pool.submit({ value: "low" }, { priority: 1 });
		const highPriority = pool.submit({ value: "high" }, { priority: 10 });

		expect(
			factory.workers[0]?.messages.map((message) => message.requestId),
		).toEqual(["test-worker:0"]);
		expect(
			factory.workers[1]?.messages.map((message) => message.requestId),
		).toEqual(["test-worker:1"]);
		expect(pool.createDiagnosticsSnapshot().queuedJobs).toMatchObject([
			{ priority: 10, requestId: "test-worker:3", stage: "queued" },
			{ priority: 1, requestId: "test-worker:2", stage: "queued" },
		]);

		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "first done" },
			requestId: "test-worker:0",
		});
		await expect(first).resolves.toEqual({ value: "first done" });
		expect(factory.workers[0]?.messages.at(-1)).toMatchObject({
			input: { value: "high" },
			requestId: "test-worker:3",
		});

		factory.workers[1]?.emit({
			kind: "result",
			output: { value: "second done" },
			requestId: "test-worker:1",
		});
		await expect(second).resolves.toEqual({ value: "second done" });
		expect(factory.workers[1]?.messages.at(-1)).toMatchObject({
			input: { value: "low" },
			requestId: "test-worker:2",
		});

		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "high done" },
			requestId: "test-worker:3",
		});
		factory.workers[1]?.emit({
			kind: "result",
			output: { value: "low done" },
			requestId: "test-worker:2",
		});

		await expect(highPriority).resolves.toEqual({ value: "high done" });
		await expect(lowPriority).resolves.toEqual({ value: "low done" });
	});

	it("forwards explicit transfer lists from domain hooks", () => {
		const factory = new FixtureWorkerFactory();
		const pool = new StandardWorkerPool<EchoInput, EchoOutput, EchoProgress>({
			createWorker: () => factory.createWorker(),
			requestIdPrefix: "test-worker",
			size: 1,
			transferInput: (input) => (input.bytes ? [input.bytes.buffer] : []),
		});
		const bytes = new Uint8Array([1, 2, 3]);

		void pool.submit({ bytes, value: "with-transfer" });

		expect(factory.workers[0]?.transfers).toEqual([[bytes.buffer]]);
	});

	it("records job descriptions in diagnostics", () => {
		const factory = new FixtureWorkerFactory();
		const pool = new StandardWorkerPool<EchoInput, EchoOutput, EchoProgress>({
			createWorker: () => factory.createWorker(),
			describe: (input) => ({
				label: input.value,
				taskId: `task:${input.value}`,
			}),
			requestIdPrefix: "test-worker",
			size: 1,
		});

		void pool.submit({ value: "described" });

		expect(pool.createDiagnosticsSnapshot().activeJobs).toMatchObject([
			{
				description: {
					label: "described",
					taskId: "task:described",
				},
				requestId: "test-worker:0",
				stage: "running",
			},
		]);
	});

	it("routes worker service requests through the configured service handler", async () => {
		const factory = new FixtureServiceWorkerFactory();
		const pool = new StandardWorkerPool<
			EchoInput,
			EchoOutput,
			EchoProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			createWorker: () => factory.createWorker(),
			requestIdPrefix: "service-worker",
			serviceHandler: async (request) => ({
				response: { value: `asset:${request.key}` },
			}),
			size: 1,
		});
		const result = pool.submit({ value: "needs-service" });

		factory.workers[0]?.emit({
			kind: "service-request",
			request: { key: "06000010" },
			requestId: "service-worker:0",
			serviceRequestId: "service:1",
		});
		await Promise.resolve();

		expect(factory.workers[0]?.messages.at(-1)).toEqual({
			kind: "service-response",
			response: { value: "asset:06000010" },
			serviceRequestId: "service:1",
		});
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			activeServiceRequests: [],
			recentServiceTimings: [
				{
					requestId: "service-worker:0",
					serviceRequestId: "service:1",
					status: "succeeded",
				},
			],
			serviceRequestFailures: 0,
			serviceRequests: 1,
		});

		factory.workers[0]?.emit({
			kind: "result",
			output: { value: "done" },
			requestId: "service-worker:0",
		});
		await expect(result).resolves.toEqual({ value: "done" });
		expect(pool.createDiagnosticsSnapshot().recentJobTimings).toMatchObject([
			{
				requestId: "service-worker:0",
				status: "succeeded",
			},
		]);
	});

	it("turns service handler failures into worker service errors", async () => {
		const factory = new FixtureServiceWorkerFactory();
		const pool = new StandardWorkerPool<
			EchoInput,
			EchoOutput,
			EchoProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			createWorker: () => factory.createWorker(),
			requestIdPrefix: "service-worker",
			serviceHandler: async () => {
				throw new Error("asset missing");
			},
			size: 1,
		});

		void pool.submit({ value: "needs-service" });
		factory.workers[0]?.emit({
			kind: "service-request",
			request: { key: "missing" },
			requestId: "service-worker:0",
			serviceRequestId: "service:2",
		});
		await Promise.resolve();

		expect(factory.workers[0]?.messages.at(-1)).toEqual({
			kind: "service-error",
			message: "asset missing",
			serviceRequestId: "service:2",
		});
		expect(pool.createDiagnosticsSnapshot()).toMatchObject({
			recentServiceTimings: [
				{
					requestId: "service-worker:0",
					serviceRequestId: "service:2",
					status: "failed",
				},
			],
			serviceRequestFailures: 1,
			serviceRequests: 1,
		});
	});

	it("drops service responses after job cancellation", async () => {
		const factory = new FixtureServiceWorkerFactory();
		let resolveService:
			| ((result: { readonly response: { readonly value: string } }) => void)
			| null = null;
		const pool = new StandardWorkerPool<
			EchoInput,
			EchoOutput,
			EchoProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			createWorker: () => factory.createWorker(),
			requestIdPrefix: "service-worker",
			serviceHandler: async () =>
				new Promise((resolve) => {
					resolveService = resolve;
				}),
			size: 1,
		});
		const handle = pool.submitHandle({ value: "needs-service" });

		factory.workers[0]?.emit({
			kind: "service-request",
			request: { key: "slow" },
			requestId: "service-worker:0",
			serviceRequestId: "service:3",
		});
		handle.cancel();
		resolveService?.({ response: { value: "late" } });
		await Promise.resolve();

		expect(factory.workers[0]?.messages).toEqual([
			{
				input: { value: "needs-service" },
				kind: "job",
				requestId: "service-worker:0",
			},
			{
				kind: "cancel",
				requestId: "service-worker:0",
			},
		]);
		await expect(handle.result).rejects.toThrow("Worker job was canceled.");
	});
});

function createPool(
	factory: FixtureWorkerFactory,
	size = 1,
): StandardWorkerPool<EchoInput, EchoOutput, EchoProgress> {
	return new StandardWorkerPool<EchoInput, EchoOutput, EchoProgress>({
		createWorker: () => factory.createWorker(),
		requestIdPrefix: "test-worker",
		size,
	});
}

class FixtureWorkerFactory {
	readonly workers: FixtureWorkerPort[] = [];

	createWorker(): FixtureWorkerPort {
		const worker = new FixtureWorkerPort();
		this.workers.push(worker);
		return worker;
	}
}

class FixtureWorkerPort implements WorkerMessagePort<
	EchoRequest,
	EchoResponse
> {
	readonly messages: EchoRequest[] = [];
	readonly transfers: readonly Transferable[][] = [];
	terminated = false;
	readonly #listeners = new Set<(event: MessageEvent<EchoResponse>) => void>();

	postMessage(
		message: EchoRequest,
		transfer: readonly Transferable[] = [],
	): void {
		this.messages.push(message);
		this.transfers.push(transfer);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<EchoResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<EchoResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: EchoResponse): void {
		const event = { data: response } as MessageEvent<EchoResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

type ServiceRequest = WorkerPoolRequestMessage<
	EchoInput,
	{ readonly value: string }
>;
type ServiceResponse = WorkerPoolResponseMessage<
	EchoOutput,
	EchoProgress,
	{ readonly key: string }
>;

class FixtureServiceWorkerFactory {
	readonly workers: FixtureServiceWorkerPort[] = [];

	createWorker(): FixtureServiceWorkerPort {
		const worker = new FixtureServiceWorkerPort();
		this.workers.push(worker);
		return worker;
	}
}

class FixtureServiceWorkerPort implements WorkerMessagePort<
	ServiceRequest,
	ServiceResponse
> {
	readonly messages: ServiceRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<ServiceResponse>) => void
	>();

	postMessage(message: ServiceRequest): void {
		this.messages.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<ServiceResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<ServiceResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: ServiceResponse): void {
		const event = { data: response } as MessageEvent<ServiceResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}
