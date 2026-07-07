import { describe, expect, it } from "vitest";
import {
	installWorkerHandler,
	type WorkerHandlerInputMessage,
	type WorkerHandlerOutputMessage,
	type WorkerHandlerPort,
} from "./handler";

interface HandlerInput {
	readonly value: string;
}

interface HandlerOutput {
	readonly value: string;
}

interface HandlerProgress {
	readonly phase: string;
}

type HandlerRequest = WorkerHandlerInputMessage<HandlerInput>;
type HandlerResponse = WorkerHandlerOutputMessage<
	HandlerOutput,
	HandlerProgress
>;

describe("worker handler", () => {
	it("executes typed jobs and posts standard results", async () => {
		const port = new FixtureWorkerHandlerPort();
		installWorkerHandler({
			execute: async (input) => ({
				output: { value: `${input.value}:done` },
			}),
			port,
		});

		port.emit({
			input: { value: "bake" },
			kind: "job",
			requestId: "job:0",
		});
		await port.waitForMessages(1);

		expect(port.messages).toEqual([
			{
				kind: "result",
				output: { value: "bake:done" },
				requestId: "job:0",
			},
		]);
	});

	it("normalizes thrown failures into standard errors", async () => {
		const port = new FixtureWorkerHandlerPort();
		installWorkerHandler({
			execute: async () => {
				throw new Error("unsupported payload");
			},
			port,
		});

		port.emit({
			input: { value: "bad" },
			kind: "job",
			requestId: "job:1",
		});
		await port.waitForMessages(1);

		expect(port.messages[0]).toMatchObject({
			kind: "error",
			message: "unsupported payload",
			requestId: "job:1",
		});
	});

	it("posts progress events and result transfer lists", async () => {
		const port = new FixtureWorkerHandlerPort();
		const progressTransfer = new ArrayBuffer(2);
		const resultTransfer = new ArrayBuffer(4);
		installWorkerHandler({
			execute: async (_input, context) => {
				context.report({ phase: "started" }, [progressTransfer]);
				return {
					output: { value: "transferred" },
					transfer: [resultTransfer],
				};
			},
			port,
		});

		port.emit({
			input: { value: "transfer" },
			kind: "job",
			requestId: "job:2",
		});
		await port.waitForMessages(2);

		expect(port.messages).toEqual([
			{
				event: { phase: "started" },
				kind: "progress",
				requestId: "job:2",
			},
			{
				kind: "result",
				output: { value: "transferred" },
				requestId: "job:2",
			},
		]);
		expect(port.transfers).toEqual([[progressTransfer], [resultTransfer]]);
	});

	it("reports cancel-before-start without executing the job", async () => {
		const port = new FixtureWorkerHandlerPort();
		let executions = 0;
		installWorkerHandler({
			execute: async () => {
				executions += 1;
				return { output: { value: "should-not-run" } };
			},
			port,
		});

		port.emit({
			kind: "cancel",
			requestId: "job:3",
		});
		port.emit({
			input: { value: "canceled" },
			kind: "job",
			requestId: "job:3",
		});
		await port.waitForMessages(1);

		expect(executions).toBe(0);
		expect(port.messages).toEqual([
			{
				kind: "error",
				message: "Worker job was canceled.",
				requestId: "job:3",
			},
		]);
	});

	it("exposes cancellation during awaited work through the request signal", async () => {
		const port = new FixtureWorkerHandlerPort();
		installWorkerHandler({
			execute: async (_input, context) => {
				await new Promise<void>((resolve) => {
					context.signal.addEventListener("abort", () => resolve(), {
						once: true,
					});
				});
				return { output: { value: "ignored-after-cancel" } };
			},
			port,
		});

		port.emit({
			input: { value: "cancel-running" },
			kind: "job",
			requestId: "job:4",
		});
		port.emit({
			kind: "cancel",
			requestId: "job:4",
		});
		await port.waitForMessages(1);

		expect(port.messages).toEqual([
			{
				kind: "error",
				message: "Worker job was canceled.",
				requestId: "job:4",
			},
		]);
	});

	it("removes its listener and aborts active work on dispose", async () => {
		const port = new FixtureWorkerHandlerPort();
		let observedAbort = false;
		const handler = installWorkerHandler({
			execute: async (_input, context) => {
				context.signal.addEventListener(
					"abort",
					() => {
						observedAbort = true;
					},
					{ once: true },
				);
				return new Promise(() => undefined);
			},
			port,
		});

		port.emit({
			input: { value: "long-running" },
			kind: "job",
			requestId: "job:5",
		});
		handler.dispose();
		port.emit({
			input: { value: "after-dispose" },
			kind: "job",
			requestId: "job:6",
		});

		expect(observedAbort).toBe(true);
		expect(port.listenerCount).toBe(0);
		expect(port.messages).toEqual([]);
	});

	it("routes requestService calls through standard service envelopes", async () => {
		const port = new FixtureServiceWorkerHandlerPort();
		installWorkerHandler<
			HandlerInput,
			HandlerOutput,
			HandlerProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			execute: async (_input, context) => {
				const response = await context.requestService({ key: "06000010" });
				return { output: { value: response.value } };
			},
			port,
		});

		port.emit({
			input: { value: "needs-service" },
			kind: "job",
			requestId: "job:7",
		});
		await port.waitForMessages(1);
		expect(port.messages[0]).toEqual({
			kind: "service-request",
			request: { key: "06000010" },
			requestId: "job:7",
			serviceRequestId: "job:7:service:0",
		});

		port.emit({
			kind: "service-response",
			response: { value: "asset" },
			serviceRequestId: "job:7:service:0",
		});
		await port.waitForMessages(2);

		expect(port.messages[1]).toEqual({
			kind: "result",
			output: { value: "asset" },
			requestId: "job:7",
		});
	});

	it("rejects requestService calls from service errors", async () => {
		const port = new FixtureServiceWorkerHandlerPort();
		installWorkerHandler<
			HandlerInput,
			HandlerOutput,
			HandlerProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			execute: async (_input, context) => {
				await context.requestService({ key: "missing" });
				return { output: { value: "unreachable" } };
			},
			port,
		});

		port.emit({
			input: { value: "needs-service" },
			kind: "job",
			requestId: "job:8",
		});
		await port.waitForMessages(1);
		port.emit({
			kind: "service-error",
			message: "asset missing",
			serviceRequestId: "job:8:service:0",
		});
		await port.waitForMessages(2);

		expect(port.messages[1]).toMatchObject({
			kind: "error",
			message: "asset missing",
			requestId: "job:8",
		});
	});

	it("rejects pending service requests when a running job is canceled", async () => {
		const port = new FixtureServiceWorkerHandlerPort();
		installWorkerHandler<
			HandlerInput,
			HandlerOutput,
			HandlerProgress,
			{ readonly key: string },
			{ readonly value: string }
		>({
			execute: async (_input, context) => {
				await context.requestService({ key: "slow" });
				return { output: { value: "unreachable" } };
			},
			port,
		});

		port.emit({
			input: { value: "needs-service" },
			kind: "job",
			requestId: "job:9",
		});
		await port.waitForMessages(1);
		port.emit({
			kind: "cancel",
			requestId: "job:9",
		});
		await port.waitForMessages(2);

		expect(port.messages[1]).toMatchObject({
			kind: "error",
			message: "Worker job was canceled.",
			requestId: "job:9",
		});
	});
});

class FixtureWorkerHandlerPort implements WorkerHandlerPort<
	HandlerInput,
	HandlerOutput,
	HandlerProgress
> {
	readonly messages: HandlerResponse[] = [];
	readonly transfers: readonly Transferable[][] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<HandlerRequest>) => void
	>();
	#waiters: Array<() => void> = [];

	get listenerCount(): number {
		return this.#listeners.size;
	}

	postMessage(
		message: HandlerResponse,
		transfer: readonly Transferable[] = [],
	): void {
		this.messages.push(message);
		this.transfers.push(transfer);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<HandlerRequest>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<HandlerRequest>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(message: HandlerRequest): void {
		const event = { data: message } as MessageEvent<HandlerRequest>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}

	waitForMessages(count: number): Promise<void> {
		if (this.messages.length >= count) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#waiters.push(() => {
				if (this.messages.length >= count) {
					resolve();
				}
			});
		});
	}

	#flushWaiters(): void {
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) {
			waiter();
		}
	}
}

type ServiceHandlerRequest = WorkerHandlerInputMessage<
	HandlerInput,
	{ readonly value: string }
>;
type ServiceHandlerResponse = WorkerHandlerOutputMessage<
	HandlerOutput,
	HandlerProgress,
	{ readonly key: string }
>;

class FixtureServiceWorkerHandlerPort implements WorkerHandlerPort<
	HandlerInput,
	HandlerOutput,
	HandlerProgress,
	{ readonly key: string },
	{ readonly value: string }
> {
	readonly messages: ServiceHandlerResponse[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<ServiceHandlerRequest>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(message: ServiceHandlerResponse): void {
		this.messages.push(message);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<ServiceHandlerRequest>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<ServiceHandlerRequest>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(message: ServiceHandlerRequest): void {
		const event = { data: message } as MessageEvent<ServiceHandlerRequest>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}

	waitForMessages(count: number): Promise<void> {
		if (this.messages.length >= count) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#waiters.push(() => {
				if (this.messages.length >= count) {
					resolve();
				}
			});
		});
	}

	#flushWaiters(): void {
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) {
			waiter();
		}
	}
}
