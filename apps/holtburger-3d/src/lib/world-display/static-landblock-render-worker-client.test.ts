import { describe, expect, it, vi } from "vitest";

import type {
	StaticLandblockRenderWorkerRequestMessage,
	StaticLandblockRenderWorkerResponseMessage,
} from "../../workers/static-landblock-render-worker";
import type { DesiredLandblockRenderPreset } from "./landblock-render-preset";
import {
	StaticLandblockRenderWorkerClient,
	type StaticLandblockRenderWorkerLike,
} from "./static-landblock-render-worker-client";

describe("static landblock render worker client", () => {
	it("posts preset jobs with renderer build policy and no legacy layer roots", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient(
			async () => [],
			() => worker,
		);

		const promise = client.requestPreset(createDesiredPreset("request:1"));

		expect(worker.postedMessages).toHaveLength(1);
		expect(worker.postedMessages[0]).toMatchObject({
			type: "run-landblock-render-preset-job",
			requestId: "static-landblock-render-1",
			job: {
				type: "build-landblock-render-preset",
				jobId: "landblock-render-preset:3663069183:outdoor:request:1",
				landblockId: 0xda55ffff,
				preset: "outdoor",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
		});
		expect(Object.keys(extractPostedJob(worker))).not.toContain("rootAssetIds");
		expect(Object.keys(extractPostedJob(worker))).not.toContain("sourceRevision");
		worker.emit({
			type: "landblock-render-preset-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:1"),
		});
		await expect(promise).resolves.toMatchObject({ requestId: "request:1" });
		client.dispose();
	});

	it("dedupes identical in-flight preset jobs", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient(
			async () => [],
			() => worker,
		);
		const desired = createDesiredPreset("request:dedupe");

		const first = client.requestPreset(desired);
		const second = client.requestPreset(desired);

		expect(second).toBe(first);
		expect(worker.postedMessages).toHaveLength(1);
		worker.emit({
			type: "landblock-render-preset-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:dedupe"),
		});
		await expect(first).resolves.toMatchObject({ requestId: "request:dedupe" });
		client.dispose();
	});

	it("rejects stale results after a newer request targets the same preset", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const client = new StaticLandblockRenderWorkerClient(
			async () => [],
			() => worker,
		);
		const stale = client.requestPreset(createDesiredPreset("request:old"));
		const latest = client.requestPreset(createDesiredPreset("request:new"));
		const staleExpectation = expect(stale).rejects.toThrow(
			"Ignored stale landblock",
		);

		worker.emit({
			type: "landblock-render-preset-job-complete",
			requestId: "static-landblock-render-1",
			result: createResult("request:old"),
		});
		worker.emit({
			type: "landblock-render-preset-job-complete",
			requestId: "static-landblock-render-2",
			result: createResult("request:new"),
		});

		await staleExpectation;
		await expect(latest).resolves.toMatchObject({
			requestId: "request:new",
			landblockId: 0xda55ffff,
			preset: "outdoor",
		});
		client.dispose();
	});

	it("forwards worker host binary lookups and transfers envelope buffers", async () => {
		const worker = new MockStaticLandblockRenderWorker();
		const lookupAssetsFn = vi.fn(async () => [
			{ payload: new ArrayBuffer(8) },
			{ payload: new ArrayBuffer(4) },
		]);
		const client = new StaticLandblockRenderWorkerClient(
			lookupAssetsFn,
			() => worker,
		);

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
});

class MockStaticLandblockRenderWorker implements StaticLandblockRenderWorkerLike {
	onmessage:
		| ((event: MessageEvent<StaticLandblockRenderWorkerResponseMessage>) => void)
		| null = null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;
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
	if (message?.type !== "run-landblock-render-preset-job") {
		throw new Error("Expected posted worker job.");
	}
	return message.job;
}

function createDesiredPreset(requestId: string): DesiredLandblockRenderPreset {
	return {
		landblockId: 0xda55ffff,
		preset: "outdoor",
		priority: "resident-now",
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: createBuildPolicy(),
	};
}

function createResult(requestId: string) {
	return {
		type: "landblock-render-preset-built" as const,
		jobId: `landblock-render-preset:3663069183:outdoor:${requestId}`,
		landblockId: 0xda55ffff,
		preset: "outdoor" as const,
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		terrainArtifact: null,
		staticBundleLayers: [],
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
