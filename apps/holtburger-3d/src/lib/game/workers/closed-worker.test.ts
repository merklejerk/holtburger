import { describe, expect, it } from "vitest";
import {
	BoundedClosedWorkerPool,
	ClosedWorkerClient,
	type ClosedWorkerPort,
	type ClosedWorkerRequest,
} from "./closed-worker";

describe("BoundedClosedWorkerPool", () => {
	it("runs no more than its configured number of closed jobs at once", async () => {
		const workers: FakeWorker[] = [];
		const pool = new BoundedClosedWorkerPool<number, number>({
			createWorker: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			workerCount: 2,
		});
		const first = pool.dispatch(1, []);
		const second = pool.dispatch(2, []);
		const third = pool.dispatch(3, []);

		expect(workers).toHaveLength(2);
		expect(workers.map((worker) => worker.requests)).toEqual([[1], [2]]);
		workers[0]!.respond(10);
		await expect(first).resolves.toBe(10);
		await Promise.resolve();
		expect(workers.map((worker) => worker.requests)).toEqual([[1, 3], [2]]);
		workers[0]!.respond(30);
		workers[1]!.respond(20);
		await expect(Promise.all([second, third])).resolves.toEqual([20, 30]);
	});

	it("rejects queued work and terminates active workers on shutdown", async () => {
		const workers: FakeWorker[] = [];
		const pool = new BoundedClosedWorkerPool<number, number>({
			createWorker: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			workerCount: 1,
		});
		const active = pool.dispatch(1, []);
		const queued = pool.dispatch(2, []);

		pool.destroy();

		await expect(active).rejects.toThrow("terminated");
		await expect(queued).rejects.toThrow("terminated");
		expect(workers[0]?.terminated).toBe(true);
	});
});

describe("ClosedWorkerClient", () => {
	it("settles pending work when destruction terminates its owned worker", async () => {
		const worker = new FakeWorker();
		const client = new ClosedWorkerClient<number, number>(worker);
		const pending = client.dispatch(1, []);

		client.destroy();

		await expect(pending).rejects.toThrow("terminated");
		expect(worker.terminated).toBe(true);
	});

	it("rejects worker-reported terminal errors without a follow-up callback", async () => {
		const worker = new FakeWorker();
		const client = new ClosedWorkerClient<number, number>(worker);
		const pending = client.dispatch(1, []);
		worker.reject("bad input");

		await expect(pending).rejects.toThrow("bad input");
	});
});

class FakeWorker implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	readonly requests: number[] = [];
	terminated = false;
	#latestRequest: ClosedWorkerRequest<number> | null = null;

	postMessage(message: ClosedWorkerRequest<unknown>): void {
		const request = message as ClosedWorkerRequest<number>;
		this.#latestRequest = request;
		this.requests.push(request.input);
	}

	respond(result: number): void {
		if (!this.#latestRequest)
			throw new Error("Fake worker has no request to answer.");
		this.onmessage?.({
			data: { id: this.#latestRequest.id, ok: true, result },
		} as MessageEvent<unknown>);
		this.#latestRequest = null;
	}

	reject(error: string): void {
		if (!this.#latestRequest)
			throw new Error("Fake worker has no request to reject.");
		this.onmessage?.({
			data: { error, id: this.#latestRequest.id, ok: false },
		} as MessageEvent<unknown>);
		this.#latestRequest = null;
	}

	terminate(): void {
		this.terminated = true;
	}
}
