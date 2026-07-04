import { describe, expect, it } from "vitest";
import { ShelfTexturePacker } from "./packer";
import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerPort,
	TexturePackingWorkerRequest,
	TexturePackingWorkerResponse,
} from "./protocol";
import { WorkerPoolTexturePacker } from "./worker-client";
import { installTexturePackingWorkerHandler } from "./worker-handler";

describe("browser texture packing worker protocol", () => {
	it("posts standard typed packing jobs and resolves atlas page pixels plus rect metadata", async () => {
		const port = new FixtureWorkerPort();
		const packer = new WorkerPoolTexturePacker({
			createWorker: () => port,
			workerCount: 1,
		});
		const job = createPackingJob();
		const result = packer.pack(job);

		expect(port.requests).toEqual([
			{
				input: job,
				kind: "job",
				requestId: "texture-pack:0",
			},
		]);
		expect(JSON.stringify(port.requests[0])).not.toContain("texture-ref");
		expect(JSON.stringify(port.requests[0])).not.toContain("drawUnit");

		port.emit({
			kind: "result",
			output: createPackingResult(job),
			requestId: "texture-pack:0",
		});

		await expect(result).resolves.toMatchObject({
			domain: "outdoor-terrain",
			jobId: "pack-job:1",
			pages: [
				{
					format: "rgba8",
					height: 2,
					pageId: "pack-job:1:page:0",
					width: 2,
				},
			],
			rects: [
				{
					entryKey: "terrain-a:prepared-texture:06000010",
					pageId: "pack-job:1:page:0",
					rect: [0, 0, 1, 1],
				},
			],
		});
		packer.dispose();
	});

	it("packs direct rgba sources in the worker handler and transfers result page pixels", async () => {
		const port = new FixtureWorkerPort();
		installTexturePackingWorkerHandler(new ShelfTexturePacker(), port);

		port.emitRequest({
			input: createPackingJob(),
			kind: "job",
			requestId: "texture-pack:7",
		});
		await port.waitForResponses(1);

		expect(port.responses[0]).toMatchObject({
			kind: "result",
			output: {
				pages: [
					{
						format: "rgba8",
						height: 1,
						pageId: "pack-job:1:page:0",
						width: 1,
					},
				],
				rects: [
					{
						entryKey: "terrain-a:prepared-texture:06000010",
						pageId: "pack-job:1:page:0",
						rect: [0, 0, 1, 1],
					},
				],
			},
			requestId: "texture-pack:7",
		});
		const response = port.responses[0];
		if (response?.kind !== "result") {
			throw new Error("Expected texture packing result response.");
		}
		expect(Array.from(response.output.pages[0]?.pixels ?? [])).toEqual([
			255, 128, 0, 255,
		]);
		expect(port.transfers).toEqual([[response.output.pages[0]?.pixels.buffer]]);
	});

	it("dispatches texture packing through the standard central worker queue", async () => {
		const first = new FixtureWorkerPort();
		const second = new FixtureWorkerPort();
		const workers = [first, second];
		const packer = new WorkerPoolTexturePacker({
			createWorker: () => {
				const worker = workers.shift();
				if (!worker) {
					throw new Error("No fixture texture packing worker remains.");
				}
				return worker;
			},
			workerCount: 2,
		});
		const firstJob = packer.pack(createPackingJob("pack-job:1"));
		const secondJob = packer.pack(createPackingJob("pack-job:2"));
		const thirdJob = packer.pack(createPackingJob("pack-job:3"));

		expect(first.requests.map((request) => request.requestId)).toEqual([
			"texture-pack:0",
		]);
		expect(second.requests.map((request) => request.requestId)).toEqual([
			"texture-pack:1",
		]);

		first.emit({
			kind: "result",
			output: createPackingResult(createPackingJob("pack-job:1")),
			requestId: "texture-pack:0",
		});
		await expect(firstJob).resolves.toMatchObject({ jobId: "pack-job:1" });
		expect(first.requests.map((request) => request.requestId)).toEqual([
			"texture-pack:0",
			"texture-pack:2",
		]);

		second.emit({
			kind: "result",
			output: createPackingResult(createPackingJob("pack-job:2")),
			requestId: "texture-pack:1",
		});
		first.emit({
			kind: "result",
			output: createPackingResult(createPackingJob("pack-job:3")),
			requestId: "texture-pack:2",
		});

		await expect(secondJob).resolves.toMatchObject({ jobId: "pack-job:2" });
		await expect(thirdJob).resolves.toMatchObject({ jobId: "pack-job:3" });
		packer.dispose();
	});

	it("turns packer failures into standard worker errors", async () => {
		const port = new FixtureWorkerPort();
		installTexturePackingWorkerHandler(
			{
				async pack(): Promise<TexturePackingResult> {
					throw new Error("source does not fit");
				},
			},
			port,
		);

		port.emitRequest({
			input: createPackingJob(),
			kind: "job",
			requestId: "texture-pack:8",
		});
		await port.waitForResponses(1);

		expect(port.responses).toEqual([
			{
				kind: "error",
				message: "source does not fit",
				requestId: "texture-pack:8",
				stack: expect.any(String) as string,
			},
		]);
	});
});

class FixtureWorkerPort implements TexturePackingWorkerPort {
	readonly requests: TexturePackingWorkerRequest[] = [];
	readonly responses: TexturePackingWorkerResponse[] = [];
	readonly transfers: readonly Transferable[][] = [];
	terminated = false;
	readonly #requestListeners = new Set<
		(event: MessageEvent<TexturePackingWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<TexturePackingWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message: TexturePackingWorkerRequest | TexturePackingWorkerResponse,
		transfer: readonly Transferable[] = [],
	): void {
		if (message.kind === "job" || message.kind === "cancel") {
			this.requests.push(message);
			return;
		}
		this.responses.push(message);
		this.transfers.push(transfer);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<TexturePackingWorkerResponse>) => void)
			| ((event: MessageEvent<TexturePackingWorkerRequest>) => void),
	): void {
		this.#responseListeners.add(
			listener as (event: MessageEvent<TexturePackingWorkerResponse>) => void,
		);
		this.#requestListeners.add(
			listener as (event: MessageEvent<TexturePackingWorkerRequest>) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<TexturePackingWorkerResponse>) => void)
			| ((event: MessageEvent<TexturePackingWorkerRequest>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (event: MessageEvent<TexturePackingWorkerResponse>) => void,
		);
		this.#requestListeners.delete(
			listener as (event: MessageEvent<TexturePackingWorkerRequest>) => void,
		);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: TexturePackingWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<TexturePackingWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: TexturePackingWorkerRequest): void {
		const event = {
			data: request,
		} as MessageEvent<TexturePackingWorkerRequest>;
		for (const listener of this.#requestListeners) {
			listener(event);
		}
	}

	waitForResponses(count: number): Promise<void> {
		if (this.responses.length >= count) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#waiters.push(() => {
				if (this.responses.length >= count) {
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

function createPackingJob(jobId = "pack-job:1"): TexturePackingJob {
	return {
		domain: "outdoor-terrain",
		jobId,
		page: {
			format: "rgba8",
			height: 2,
			width: 2,
		},
		placementRevision: 3,
		sources: [
			{
				entryKey: "terrain-a:prepared-texture:06000010",
				source: {
					format: "rgba8",
					height: 1,
					kind: "texture-packing-pixel-source",
					pixels: new Uint8Array([255, 128, 0, 255]),
					width: 1,
				},
			},
		],
	};
}

function createPackingResult(job: TexturePackingJob): TexturePackingResult {
	return {
		domain: job.domain,
		jobId: job.jobId,
		pages: [
			{
				format: "rgba8",
				height: 2,
				pageId: `${job.jobId}:page:0`,
				pixels: new Uint8Array(16),
				width: 2,
			},
		],
		placementRevision: job.placementRevision,
		rects: [
			{
				entryKey: "terrain-a:prepared-texture:06000010",
				pageId: `${job.jobId}:page:0`,
				rect: [0, 0, 1, 1],
			},
		],
	};
}
