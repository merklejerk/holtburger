import { describe, expect, it } from "vitest";

import { RenderResourceJobScheduler } from "./render-resource-job-scheduler";
import type { RenderResourceWorkerLike } from "./render-resource-worker-client";
import { RenderResourceWorkerClient } from "./render-resource-worker-client";
import { IndexedResourceAtlasWorkerScheduler } from "./worker-resources/indexed-atlas-worker-scheduler";
import type { BuildIndexedResourceAtlasWorkerInput } from "./worker-resources/indexed-atlas-worker-payloads";
import { TextureAtlasWorkerScheduler } from "./worker-resources/texture-atlas-worker-scheduler";
import type { BuildTextureAtlasWorkerInput } from "./worker-resources/texture-atlas-worker-payloads";
import type {
	RenderResourceWorkerRequestMessage,
	RenderResourceWorkerResponseMessage,
} from "../../workers/render-resource-worker";

describe("render resource worker client", () => {
	it("correlates typed job responses by request id", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const input = createIndexedAtlasWorkerInput();

		const resultPromise = client.runBuildIndexedResourceAtlasJob({
			type: "build-indexed-resource-atlas",
			key: input.key,
			input,
		});

		expect(worker.messages).toEqual([
			{
				type: "run-job",
				requestId: "render-resource-1",
				job: {
					type: "build-indexed-resource-atlas",
					key: "indexed-plan:a",
					input,
				},
			},
		]);
		expect(worker.transferLists[0]).toHaveLength(2);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
			durationMs: 1.5,
		});

		await expect(resultPromise).resolves.toEqual({
			type: "build-indexed-resource-atlas",
			key: "indexed-plan:a",
			generation: null,
		});
	});

	it("rejects pending work on dispose and ignores late responses", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const input = createIndexedAtlasWorkerInput();
		const resultPromise = client.runBuildIndexedResourceAtlasJob({
			type: "build-indexed-resource-atlas",
			key: input.key,
			input,
		});

		client.dispose();
		expect(worker.wasTerminated).toBe(true);
		await expect(resultPromise).rejects.toThrow(/disposed/);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
			durationMs: 1,
		});
	});

	it("submits indexed atlas worker jobs with copied source buffers as transferables", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const input = createIndexedAtlasWorkerInput();

		const resultPromise = client.runBuildIndexedResourceAtlasJob({
			type: "build-indexed-resource-atlas",
			key: input.key,
			input,
		});

		expect(worker.messages).toEqual([
			{
				type: "run-job",
				requestId: "render-resource-1",
				job: {
					type: "build-indexed-resource-atlas",
					key: "indexed-plan:a",
					input,
				},
			},
		]);
		expect(worker.transferLists[0]).toHaveLength(2);

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
			durationMs: 1,
		});

		await expect(resultPromise).resolves.toEqual({
			type: "build-indexed-resource-atlas",
			key: "indexed-plan:a",
			generation: null,
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

describe("indexed resource atlas worker scheduler", () => {
	it("submits indexed atlas jobs and reports ready results", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		let readyNotificationCount = 0;
		const scheduler = new IndexedResourceAtlasWorkerScheduler({
			client,
			onReadyResult() {
				readyNotificationCount += 1;
			},
		});
		const input = createIndexedAtlasWorkerInput();

		scheduler.scheduleDesired(createIndexedAtlasPlan(input));

		expect(worker.messages).toHaveLength(1);
		expect(worker.messages[0]?.job).toMatchObject({
			type: "build-indexed-resource-atlas",
			key: "indexed-plan:a",
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(readyNotificationCount).toBe(1);
		expect(scheduler.consumeReadyResults()).toEqual([
			{
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			activeSchedulerCount: 1,
			submittedJobCount: 1,
			readyResultCount: 1,
		});
	});

	it("coalesces stale indexed atlas jobs and can reset in-flight work", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const scheduler = new IndexedResourceAtlasWorkerScheduler({
			client,
			onReadyResult() {
				return;
			},
		});

		scheduler.scheduleDesired(
			createIndexedAtlasPlan(createIndexedAtlasWorkerInput("indexed-plan:a")),
		);
		scheduler.scheduleDesired(
			createIndexedAtlasPlan(createIndexedAtlasWorkerInput("indexed-plan:b")),
		);

		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 1,
			coalescedDesiredJobCount: 1,
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:a",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(worker.messages).toHaveLength(2);
		expect(worker.messages[1]?.job.key).toBe("indexed-plan:b");
		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 2,
			staleResultCount: 1,
		});

		scheduler.reset();
		worker.emit({
			type: "job-complete",
			requestId: "render-resource-2",
			result: {
				type: "build-indexed-resource-atlas",
				key: "indexed-plan:b",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(scheduler.getMetrics()).toMatchObject({
			activeSchedulerCount: 0,
			submittedJobCount: 0,
		});
	});
});

describe("texture atlas worker scheduler", () => {
	it("submits texture atlas jobs and reports ready results", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		let readyNotificationCount = 0;
		const scheduler = new TextureAtlasWorkerScheduler({
			client,
			onReadyResult() {
				readyNotificationCount += 1;
			},
		});

		scheduler.scheduleDesired({
			plan: createTextureAtlasPlan(createTextureAtlasWorkerInput()),
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});

		expect(worker.messages).toHaveLength(1);
		expect(worker.messages[0]?.job).toMatchObject({
			type: "build-texture-atlas",
			key: "texture-page-atlas/a;filter=anisotropic-4x;aniso=1",
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-texture-atlas",
				key: "texture-page-atlas/a;filter=anisotropic-4x;aniso=1",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(readyNotificationCount).toBe(1);
		expect(scheduler.consumeReadyResults()).toEqual([
			{
				type: "build-texture-atlas",
				key: "texture-page-atlas/a;filter=anisotropic-4x;aniso=1",
				generation: null,
			},
		]);
		expect(scheduler.getMetrics()).toMatchObject({
			activeSchedulerCount: 1,
			submittedJobCount: 1,
			readyResultCount: 1,
		});
	});

	it("coalesces stale texture atlas jobs and can reset in-flight work", async () => {
		const worker = new FakeRenderResourceWorker();
		const client = new RenderResourceWorkerClient(() => worker);
		const scheduler = new TextureAtlasWorkerScheduler({
			client,
			onReadyResult() {
				return;
			},
		});

		scheduler.scheduleDesired({
			plan: createTextureAtlasPlan(createTextureAtlasWorkerInput("a")),
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});
		scheduler.scheduleDesired({
			plan: createTextureAtlasPlan(createTextureAtlasWorkerInput("b")),
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});

		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 1,
			coalescedDesiredJobCount: 1,
		});

		worker.emit({
			type: "job-complete",
			requestId: "render-resource-1",
			result: {
				type: "build-texture-atlas",
				key: "texture-page-atlas/a;filter=anisotropic-4x;aniso=1",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(worker.messages).toHaveLength(2);
		expect(worker.messages[1]?.job.key).toBe(
			"texture-page-atlas/b;filter=anisotropic-4x;aniso=1",
		);
		expect(scheduler.getMetrics()).toMatchObject({
			submittedJobCount: 2,
			staleResultCount: 1,
		});

		scheduler.reset();
		worker.emit({
			type: "job-complete",
			requestId: "render-resource-2",
			result: {
				type: "build-texture-atlas",
				key: "texture-page-atlas/b;filter=anisotropic-4x;aniso=1",
				generation: null,
			},
			durationMs: 1,
		});
		await waitForMicrotasks();

		expect(scheduler.consumeReadyResults()).toEqual([]);
		expect(scheduler.getMetrics()).toMatchObject({
			activeSchedulerCount: 0,
			submittedJobCount: 0,
		});
	});
});

function createIndexedAtlasWorkerInput(
	key = "indexed-plan:a",
): BuildIndexedResourceAtlasWorkerInput {
	return {
		key,
		indexReadyDrawUnitIds: ["index-draw"],
		paletteReadyDrawUnitIds: ["palette-draw"],
		p8IndexAtlasTextures: [
			{
				format: "p8",
				textureIndex: 0,
				width: 2,
				height: 2,
				placements: [
					{
						indexTextureKey: "index/a",
						format: "p8",
						atlasTextureIndex: 0,
						x: 0,
						y: 0,
						width: 1,
						height: 1,
						sourceBytes: Uint8Array.from([1]),
					},
				],
			},
		],
		index16AtlasTextures: [],
		paletteAtlasTextures: [
			{
				textureIndex: 0,
				width: 1,
				height: 1,
				placements: [
					{
						paletteTextureKey: "palette/a",
						atlasTextureIndex: 0,
						x: 0,
						y: 0,
						colorCount: 1,
						rgbaBytes: Uint8Array.from([2, 3, 4, 5]),
					},
				],
			},
		],
	};
}

function createIndexedAtlasPlan(input: BuildIndexedResourceAtlasWorkerInput) {
	return {
		key: input.key,
		indexReadyDrawUnitIds: input.indexReadyDrawUnitIds,
		paletteReadyDrawUnitIds: input.paletteReadyDrawUnitIds,
		failures: [],
		p8IndexAtlasTextures: input.p8IndexAtlasTextures,
		index16AtlasTextures: input.index16AtlasTextures,
		paletteAtlasTextures: input.paletteAtlasTextures,
		indexPlacementsByTextureKey: new Map(),
		palettePlacementsByTextureKey: new Map(),
	};
}

function createTextureAtlasWorkerInput(
	suffix = "a",
): BuildTextureAtlasWorkerInput {
	return {
		key: `texture-page-atlas/${suffix}`,
		textureFilteringMode: "anisotropic-4x",
		maxAnisotropy: 1,
		rgbaAtlasReadyDrawUnitIds: ["draw-a"],
		detailAtlasTextures: [],
		families: [],
		preparedTextureAssetIds: [],
	};
}

function createTextureAtlasPlan(input: BuildTextureAtlasWorkerInput) {
	return {
		key: input.key,
		rgbaAtlasReadyDrawUnitIds: input.rgbaAtlasReadyDrawUnitIds,
		detailAtlasReadyDrawUnitIds: [],
		failures: [],
		atlasEntryRecords: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: input.detailAtlasTextures,
		families: input.families,
		preparedTextureAssetIds: input.preparedTextureAssetIds,
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
