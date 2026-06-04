import { describe, expect, it } from "vitest";

import { RenderResourceJobScheduler } from "./render-resource-job-scheduler";
import type { RenderResourceWorkerLike } from "./render-resource-worker-client";
import { RenderResourceWorkerClient } from "./render-resource-worker-client";
import { CompactedGeometryWorkerScheduler } from "./worker-resources/compacted-geometry-worker-scheduler";
import type {
	RenderResourceWorkerRequestMessage,
	RenderResourceWorkerResponseMessage,
} from "../../workers/render-resource-worker";

describe("render resource worker client", () => {
	it("correlates echo job responses by request id", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);

		const resultPromise = client.runEchoJob({
			type: "echo",
			key: "echo:a",
			payload: "hello",
		});

		expect(worker.messages).toEqual([
			{
				type: "run-job",
				requestId: "render-resource-1",
				job: {
					type: "echo",
					key: "echo:a",
					payload: "hello",
				},
			},
		]);
		expect(worker.transferLists).toEqual([[]]);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "echo",
				key: "echo:a",
				payload: "hello",
			},
			durationMs: 1.5,
		});

		await expect(resultPromise).resolves.toEqual({
			type: "echo",
			key: "echo:a",
			payload: "hello",
		});
	});

	it("rejects pending work on dispose and ignores late responses", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const resultPromise = client.runEchoJob({
			type: "echo",
			key: "echo:a",
			payload: "hello",
		});

		client.dispose();
		expect(worker.wasTerminated).toBe(true);
		await expect(resultPromise).rejects.toThrow(/disposed/);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "echo",
				key: "echo:a",
				payload: "hello",
			},
			durationMs: 1,
		});
	});
});

describe("render resource job scheduler", () => {
	it("dedupes desired jobs that are already in flight", async () => {
		const driver = new SchedulerDriver();
		const scheduler = driver.createScheduler();

		scheduler.scheduleDesired({ key: "resource:a", payload: "first" });
		scheduler.scheduleDesired({ key: "resource:a", payload: "duplicate" });

		expect(driver.submittedInputs).toEqual([
			{ key: "resource:a", payload: "first" },
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 1,
			dedupedDesiredJobCount: 1,
		});

		driver.resolve("resource:a");
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([
			{ key: "resource:a", payload: "result:resource:a" },
		]);
	});

	it("coalesces replacement desired work while one job is active", async () => {
		const driver = new SchedulerDriver();
		const scheduler = driver.createScheduler();

		scheduler.scheduleDesired({ key: "resource:a", payload: "first" });
		scheduler.scheduleDesired({ key: "resource:b", payload: "second" });
		scheduler.scheduleDesired({ key: "resource:c", payload: "third" });

		expect(driver.submittedInputs).toEqual([
			{ key: "resource:a", payload: "first" },
		]);

		driver.resolve("resource:a");
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(driver.submittedInputs).toEqual([
			{ key: "resource:a", payload: "first" },
			{ key: "resource:c", payload: "third" },
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			coalescedDesiredJobCount: 2,
			staleResultCount: 1,
		});

		driver.resolve("resource:c");
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([
			{ key: "resource:c", payload: "result:resource:c" },
		]);
	});

	it("clears pending replacement when desired returns to the in-flight key", async () => {
		const driver = new SchedulerDriver();
		const scheduler = driver.createScheduler();

		scheduler.scheduleDesired({ key: "resource:a", payload: "first" });
		scheduler.scheduleDesired({ key: "resource:b", payload: "second" });
		scheduler.scheduleDesired({ key: "resource:a", payload: "first-again" });

		driver.resolve("resource:a");
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([
			{ key: "resource:a", payload: "result:resource:a" },
		]);
		expect(driver.submittedInputs).toEqual([
			{ key: "resource:a", payload: "first" },
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			coalescedDesiredJobCount: 1,
			dedupedDesiredJobCount: 1,
		});
	});

	it("uses explicit commit notification for committed-key dedupe", async () => {
		const driver = new SchedulerDriver();
		const scheduler = driver.createScheduler();

		scheduler.scheduleDesired({ key: "resource:a", payload: "first" });
		driver.resolve("resource:a");
		await waitForMicrotasks();
		const [readyResult] = scheduler.consumeReadyResults();
		if (!readyResult) {
			throw new Error("expected ready result");
		}

		scheduler.markCommitted(readyResult.key);
		scheduler.scheduleDesired({ key: "resource:a", payload: "duplicate" });

		expect(driver.submittedInputs).toEqual([
			{ key: "resource:a", payload: "first" },
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			committedResultCount: 1,
			dedupedDesiredJobCount: 1,
		});
	});

	it("drops late completions after disposal", async () => {
		const driver = new SchedulerDriver();
		const scheduler = driver.createScheduler();

		scheduler.scheduleDesired({ key: "resource:a", payload: "first" });
		scheduler.dispose();
		driver.resolve("resource:a");
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(scheduler.getMetrics()).toMatchObject({
			readyResultCount: 0,
			staleResultCount: 0,
		});
	});
});

describe("compacted geometry worker scheduler", () => {
	it("submits compacted jobs and reports ready results by group key", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		let readyNotificationCount = 0;
		const scheduler = new CompactedGeometryWorkerScheduler({
			client,
			onReadyResult() {
				readyNotificationCount += 1;
			},
		});

		scheduler.scheduleDesired({
			groupKey: "rgbaAtlas|partition=abcd|landblock=12340000",
			desiredJobKey: "compacted-geometry|job=a",
			plan: {
				key: "plan:a",
				compactableDrawUnitIds: [],
				materialSlots: [],
				drawUnitMaterialSlots: [],
				drawSlices: [],
				triangleCount: 0,
			},
			drawUnits: [],
			batchOrigin: { x: 0, y: 0, z: 0 },
		});

		expect(worker.messages).toEqual([
			{
				type: "run-job",
				requestId: "render-resource-1",
				job: {
					type: "build-compacted-geometry",
					key: "compacted-geometry|job=a",
					input: {
						key: "compacted-geometry|job=a",
						plan: {
							key: "plan:a",
							compactableDrawUnitIds: [],
							materialSlots: [],
							drawUnitMaterialSlots: [],
							drawSlices: [],
							triangleCount: 0,
						},
						drawUnits: [],
						batchOrigin: { x: 0, y: 0, z: 0 },
					},
				},
			},
		]);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-compacted-geometry",
				key: "compacted-geometry|job=a",
				geometry: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(readyNotificationCount).toBe(1);
		expect(scheduler.consumeReadyResults()).toEqual([
			{
				groupKey: "rgbaAtlas|partition=abcd|landblock=12340000",
				result: {
					type: "build-compacted-geometry",
					key: "compacted-geometry|job=a",
					geometry: null,
				},
			},
		]);

		scheduler.dispose();
		expect(worker.wasTerminated).toBe(true);
	});

	it("aggregates compacted job metrics and discards stale results", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const scheduler = new CompactedGeometryWorkerScheduler({
			client,
			onReadyResult() {
				return;
			},
		});

		scheduler.scheduleDesired(createCompactedDesiredBatch("job:a"));
		scheduler.scheduleDesired(createCompactedDesiredBatch("job:b"));

		expect(scheduler.getMetrics()).toMatchObject({
			activeSchedulerCount: 1,
			submittedJobCount: 1,
			coalescedDesiredJobCount: 1,
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-compacted-geometry",
				key: "job:a",
				geometry: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(worker.messages).toHaveLength(2);
		expect(worker.messages[1]?.job.key).toBe("job:b");
		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 2,
			staleResultCount: 1,
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-2",
			result: {
				type: "build-compacted-geometry",
				key: "job:b",
				geometry: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([
			{
				groupKey: "rgbaAtlas|partition=abcd|landblock=12340000",
				result: {
					type: "build-compacted-geometry",
					key: "job:b",
					geometry: null,
				},
			},
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			readyResultCount: 1,
		});
	});
});

function createCompactedDesiredBatch(
	desiredJobKey: string,
): Parameters<CompactedGeometryWorkerScheduler["scheduleDesired"]>[0] {
	return {
		groupKey: "rgbaAtlas|partition=abcd|landblock=12340000",
		desiredJobKey,
		plan: {
			key: "plan:a",
			compactableDrawUnitIds: [],
			materialSlots: [],
			drawUnitMaterialSlots: [],
			drawSlices: [],
			triangleCount: 0,
		},
		drawUnits: [],
		batchOrigin: { x: 0, y: 0, z: 0 },
	};
}

interface TestSchedulerInput {
	key: string;
	payload: string;
}

interface TestSchedulerResult {
	key: string;
	payload: string;
}

class SchedulerDriver {
	readonly submittedInputs: TestSchedulerInput[] = [];

	private readonly pendingResolves = new Map<
		string,
		(result: TestSchedulerResult) => void
	>();

	createScheduler(): RenderResourceJobScheduler<
		TestSchedulerInput,
		TestSchedulerResult
	> {
		return new RenderResourceJobScheduler({
			getInputKey: (input) => input.key,
			getResultKey: (result) => result.key,
			submit: (input) => this.submit(input),
		});
	}

	resolve(key: string): void {
		const resolve = this.pendingResolves.get(key);
		if (!resolve) {
			throw new Error(`No pending job for ${key}.`);
		}

		this.pendingResolves.delete(key);
		resolve({ key, payload: `result:${key}` });
	}

	private submit(input: TestSchedulerInput): Promise<TestSchedulerResult> {
		this.submittedInputs.push(input);
		return new Promise<TestSchedulerResult>((resolve) => {
			this.pendingResolves.set(input.key, resolve);
		});
	}
}

class FakeRenderResourceWorker implements RenderResourceWorkerLike {
	onmessage:
		| ((event: MessageEvent<RenderResourceWorkerResponseMessage>) => void)
		| null = null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;
	readonly messages: RenderResourceWorkerRequestMessage[] = [];
	readonly transferLists: Transferable[][] = [];
	wasTerminated = false;

	postMessage(
		message: RenderResourceWorkerRequestMessage,
		transferables: Transferable[] = [],
	): void {
		this.messages.push(message);
		this.transferLists.push(transferables);
	}

	terminate(): void {
		this.wasTerminated = true;
	}

	emit(message: RenderResourceWorkerResponseMessage): void {
		this.onmessage?.({
			data: message,
		} as MessageEvent<RenderResourceWorkerResponseMessage>);
	}
}

async function waitForMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
