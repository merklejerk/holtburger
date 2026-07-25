import { describe, expect, it } from "vitest";
import { ClosedWorkerClient, type ClosedWorkerPort } from "./closed-worker";

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
		worker.respond({ error: "bad input", id: 0, ok: false });

		await expect(pending).rejects.toThrow("bad input");
	});
});

class FakeWorker implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(): void {}

	respond(data: unknown): void {
		this.onmessage?.({ data } as MessageEvent<unknown>);
	}

	terminate(): void {
		this.terminated = true;
	}
}
