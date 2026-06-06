import { describe, expect, it, vi } from "vitest";

import type {
	StaticLandblockRenderWorkerRequestMessage,
	StaticLandblockRenderWorkerResponseMessage,
} from "../../workers/static-landblock-render-worker";
import {
	createLandblockRenderProductWorkerJob,
	type DesiredLandblockRenderProduct,
} from "./landblock-render-product";
import {
	StaticLandblockRenderWorkerClient,
	type StaticLandblockRenderWorkerLike,
} from "./static-landblock-render-worker-client";

describe("static landblock render worker client", () => {
	it("posts product jobs with renderer build policy and no legacy layer roots", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
			maxConcurrentJobs: 2,
		});

		const promise = client.requestProduct(createDesiredProduct("request:1"));

		expect(worker.postedMessages).toHaveLength(1);
		expect(worker.postedMessages[0]).toMatchObject({
			type: "run-landblock-render-product-job",
			requestId: "static-landblock-render-1",
			job: {
				type: "build-landblock-render-product",
				jobId:
					"landblock-render-product:3663069183:outdoor:build:v1:texture-pages:v1:artifacts:all",
				landblockId: 0xda55ffff,
				product: "outdoor",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
				artifactFilter: null,
			},
		});
		expect(Object.keys(extractPostedJob(worker))).not.toContain("rootAssetIds");
		expect(Object.keys(extractPostedJob(worker))).not.toContain(
			"sourceRevision",
		);
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:1"),
		});
		await expect(promise).resolves.toMatchObject({ requestId: "request:1" });
		client.dispose();
	});

	it("defaults to one active posted worker job", () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
		});

		void client.requestProduct(createDesiredProduct("request:one"));
		void client.requestProduct(
			createDesiredProduct("request:two", { product: "outdoor-env-cells" }),
		);

		expect(
			worker.postedMessages.filter(
				(message) => message.type === "run-landblock-render-product-job",
			),
		).toHaveLength(1);
		client.dispose();
	});

	it("drops stale queued products before posting them to the worker", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
		});
		const active = client.requestProduct(
			createDesiredProduct("request:active", {
				product: "outdoor-env-cells",
			}),
		);
		const staleQueued = client.requestProduct(
			createDesiredProduct("request:old"),
		);
		const staleExpectation = expect(staleQueued).rejects.toThrow(
			"superseded",
		);
		const latestQueued = client.requestProduct(
			createDesiredProduct("request:new"),
		);

		expect(
			worker.postedMessages.filter(
				(message) => message.type === "run-landblock-render-product-job",
			),
		).toHaveLength(1);
		await staleExpectation;
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:active", {
				product: "outdoor-env-cells",
			}),
		});
		await expect(active).resolves.toMatchObject({
			requestId: "request:active",
		});
		expect(worker.postedMessages.at(-1)).toMatchObject({
			type: "run-landblock-render-product-job",
			requestId: "static-landblock-render-3",
		});
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-3",
			result: createResult("request:new"),
		});
		await expect(latestQueued).resolves.toMatchObject({
			requestId: "request:new",
		});
		client.dispose();
	});

	it("cancels superseded posted products by worker request id", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
			maxConcurrentJobs: 2,
		});
		const stale = client.requestProduct(createDesiredProduct("request:old"));
		const staleExpectation = expect(stale).rejects.toThrow("superseded");

		void client.requestProduct(createDesiredProduct("request:new"));

		await staleExpectation;
		expect(worker.postedMessages).toContainEqual({
			type: "cancel-landblock-render-product-job",
			requestId: "static-landblock-render-1",
		});
		client.dispose();
	});

	it("keeps product job identity stable across request-only replans", () => {
		const first = createDesiredProduct("request:first");
		const second = createDesiredProduct("request:second");

		expect(extractProductJobId(first)).toBe(extractProductJobId(second));
	});

	it("dedupes identical in-flight product jobs", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
		});
		const desired = createDesiredProduct("request:dedupe");

		const first = client.requestProduct(desired);
		const second = client.requestProduct(desired);

		expect(second).toBe(first);
		expect(worker.postedMessages).toHaveLength(1);
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:dedupe"),
		});
		await expect(first).resolves.toMatchObject({ requestId: "request:dedupe" });
		client.dispose();
	});

	it("rejects worker results that do not match the pending request identity", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
		});
		const stale = client.requestProduct(createDesiredProduct("request:current"));

		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:old"),
		});

		await expect(stale).rejects.toThrow(
			"Ignored stale landblock",
		);
		client.dispose();
	});

	it("posts queued work after the active worker request completes", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
		});
		const first = client.requestProduct(createDesiredProduct("request:first"));
		const second = client.requestProduct(
			createDesiredProduct("request:second", {
				product: "outdoor-env-cells",
			}),
		);
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:first"),
		});
		await expect(first).resolves.toMatchObject({
			requestId: "request:first",
		});
		expect(worker.postedMessages.at(-1)).toMatchObject({
			type: "run-landblock-render-product-job",
			requestId: "static-landblock-render-2",
		});
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-2",
			result: createResult("request:second", {
				product: "outdoor-env-cells",
			}),
		});
		await expect(second).resolves.toMatchObject({
			requestId: "request:second",
			product: "outdoor-env-cells",
		});
		client.dispose();
	});

	it("forwards worker host binary lookups and transfers envelope buffers", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const lookupAssetsFn = vi.fn(async () => [
			{ payload: new ArrayBuffer(8) },
			{ payload: new ArrayBuffer(4) },
		]);
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn,
			workerFactory: () => worker,
		});

		worker.emit({
			type: "host-lookup-assets-binary",
			requestId: "host:1",
			requests: [
				{
					requestId: "asset:1",
					assetId: "landblock/da55ffff/outdoor",
					priority: "streaming",
				},
			],
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(lookupAssetsFn).toHaveBeenCalledWith([
			{
				requestId: "asset:1",
				assetId: "landblock/da55ffff/outdoor",
				priority: "streaming",
			},
		]);
		expect(worker.postedMessages.at(-1)).toMatchObject({
			type: "host-lookup-assets-binary-complete",
			requestId: "host:1",
			envelopes: [
				{ payload: expect.any(ArrayBuffer) },
				{ payload: expect.any(ArrayBuffer) },
			],
		});
		expect(worker.postedTransferables.at(-1)).toHaveLength(2);
		client.dispose();
	});

	it("bounds concurrent product jobs and dispatches queued jobs after completion", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient({
			lookupAssetsFn: async () => [],
			workerFactory: () => worker,
			maxConcurrentJobs: 1,
		});

		const first = client.requestProduct(createDesiredProduct("request:first"));
		const second = client.requestProduct(
			createDesiredProduct("request:second", { landblockId: 0xda56ffff }),
		);

		expect(worker.postedMessages).toHaveLength(1);
		expect(extractPostedJob(worker)).toMatchObject({
			requestId: "request:first",
		});
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:first"),
		});
		await expect(first).resolves.toMatchObject({
			requestId: "request:first",
		});

		expect(worker.postedMessages).toHaveLength(2);
		const secondMessage = worker.postedMessages[1];
		expect(secondMessage).toMatchObject({
			type: "run-landblock-render-product-job",
			requestId: "static-landblock-render-2",
			job: {
				requestId: "request:second",
			},
		});
		worker.emit({
			type: "landblock-render-product-job-complete",
			requestId: "static-landblock-render-2",
			result: createResult("request:second", { landblockId: 0xda56ffff }),
		});
		await expect(second).resolves.toMatchObject({
			requestId: "request:second",
		});
		client.dispose();
	});
});

class MockStaticLandblockRenderWorker implements StaticLandblockRenderWorkerLike {
	onmessage:
		| ((
				event: MessageEvent<StaticLandblockRenderWorkerResponseMessage>,
		  ) => void)
		| null = null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	postedMessages: StaticLandblockRenderWorkerRequestMessage[] = [];
	postedTransferables: readonly Transferable[][] = [];
	terminated = false;

	postMessage(
		message: StaticLandblockRenderWorkerRequestMessage,
		transferables: Transferable[] = [],
	): void {
		this.postedMessages.push(message);
		this.postedTransferables = [...this.postedTransferables, transferables];
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: StaticLandblockRenderWorkerResponseMessage): void {
		this.onmessage?.({
			data: message,
		} as MessageEvent<StaticLandblockRenderWorkerResponseMessage>);
	}
}

function extractPostedJob(worker: MockStaticLandblockRenderWorker) {
	const message = worker.postedMessages[0];
	if (message?.type !== "run-landblock-render-product-job") {
		throw new Error("Expected posted worker job.");
	}
	return message.job;
}

function createDesiredProduct(
	requestId: string,
	overrides: Partial<DesiredLandblockRenderProduct> = {},
): DesiredLandblockRenderProduct {
	return {
		landblockId: 0xda55ffff,
		product: "outdoor",
		priority: "resident-now",
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: createBuildPolicy(),
		...overrides,
	};
}

function extractProductJobId(desired: DesiredLandblockRenderProduct): string {
	return createLandblockRenderProductWorkerJob(desired).jobId;
}

function createResult(
	requestId: string,
	overrides: Partial<ReturnType<typeof createResultBase>> = {},
) {
	return {
		...createResultBase(requestId),
		...overrides,
	};
}

function createResultBase(requestId: string) {
	return {
		type: "landblock-render-product-built" as const,
		jobId: `landblock-render-product:3663069183:outdoor:${requestId}`,
		landblockId: 0xda55ffff,
		product: "outdoor" as const,
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		artifacts: [],
		diagnostics: {
			status: "ready" as const,
			messages: [],
		},
	};
}

function createBuildPolicy() {
	return {
		atlasLayout: {
			maxTextureSize: 64,
			maxTextureCount: 4,
			gutterPixels: 0,
		},
		terrainMaxLayerEntries: 8,
	};
}
