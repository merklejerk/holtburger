import { describe, expect, it } from "vitest";

import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../../../assets/contracts";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../../../static/contracts";
import { createRequestScopedPreparedAssetReader } from "../../../../workers/prepared-asset-service";
import type { OpenWorldTextureEntryId } from "../claims/texture-claim-registry";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasBuilder,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "./object-visual-atlas-builder";
import { WorkerPoolOpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-worker-client";
import { installOpenWorldObjectVisualAtlasWorkerHandler } from "./object-visual-atlas-worker-handler";
import type {
	OpenWorldObjectVisualAtlasWorkerPort,
	OpenWorldObjectVisualAtlasWorkerRequest,
	OpenWorldObjectVisualAtlasWorkerResponse,
} from "./object-visual-atlas-worker-protocol";

describe("WorkerPoolOpenWorldObjectVisualAtlasBuilder", () => {
	it("dispatches placement layout jobs through the worker pool", async () => {
		const port = new FixtureObjectVisualAtlasWorkerPort();
		const builder = new WorkerPoolOpenWorldObjectVisualAtlasBuilder({
			assetReader: createUnusedAssetReader(),
			createWorker: () => port,
			workerCount: 1,
		});
		const input = createLayoutInput();
		const result = builder.planAtlasPlacement(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "job",
				requestId: "open-world-texture-layout:0",
			},
		]);

		port.emit({
			kind: "result",
			output: createLayoutOutput(),
			requestId: "open-world-texture-layout:0",
		});

		await expect(result).resolves.toEqual(createLayoutOutput());
		builder.dispose();
	});

	it("exposes atlas layout queue diagnostics from the worker pool", () => {
		const port = new FixtureObjectVisualAtlasWorkerPort();
		const builder = new WorkerPoolOpenWorldObjectVisualAtlasBuilder({
			assetReader: createUnusedAssetReader(),
			createWorker: () => port,
			workerCount: 1,
		});

		const firstLayout = builder.planAtlasPlacement(
			createLayoutInput({ jobId: "layout:first" }),
		);
		const secondLayout = builder.planAtlasPlacement(
			createLayoutInput({ jobId: "layout:second" }),
		);
		void firstLayout.catch(() => undefined);
		void secondLayout.catch(() => undefined);

		expect(builder.createDiagnosticsSnapshot()).toMatchObject({
			activeJobs: [
				{
					description: {
						label: "open-world-texture-layout",
						taskId: "layout:first",
					},
					stage: "running",
				},
			],
			queuedJobs: [
				{
					description: {
						label: "open-world-texture-layout",
						taskId: "layout:second",
					},
					stage: "queued",
				},
			],
			submittedJobs: 2,
			workerCount: 1,
		});
		builder.dispose();
	});

	it("runs atlas jobs in the worker handler with request-scoped prepared asset access", async () => {
		const port = new FixtureObjectVisualAtlasWorkerPort();
		installOpenWorldObjectVisualAtlasWorkerHandler(
			(assetReader) => new AssetReadingFixtureAtlasBuilder(assetReader),
			createRequestScopedPreparedAssetReader,
			port,
		);
		const input = createLayoutInput({ jobId: "layout:asset-service" });

		port.emitRequest({
			input,
			kind: "job",
			requestId: "open-world-texture-layout:9",
		});
		await port.waitForResponses(1);

		expect(port.responses[0]).toEqual({
			kind: "service-request",
			request: {
				key: { id: "prepared-texture/06000010", kind: "prepared-texture" },
				kind: "prepared-asset",
			},
			requestId: "open-world-texture-layout:9",
			serviceRequestId: "open-world-texture-layout:9:service:0",
		});
		port.emitRequest({
			kind: "service-response",
			response: {
				asset: createPreparedTextureAsset(),
				kind: "prepared-asset",
			},
			serviceRequestId: "open-world-texture-layout:9:service:0",
		});
		await port.waitForResponses(2);

		expect(port.responses[1]).toMatchObject({
			kind: "result",
			output: {
				pages: [{ pageId: "asset:prepared-texture/06000010" }],
				stageTimings: [
					{
						count: 1,
						stage: "texture-source-preparation",
					},
				],
			},
			requestId: "open-world-texture-layout:9",
		});
	});
});

class FixtureObjectVisualAtlasWorkerPort implements OpenWorldObjectVisualAtlasWorkerPort {
	readonly requests: OpenWorldObjectVisualAtlasWorkerRequest[] = [];
	readonly responses: OpenWorldObjectVisualAtlasWorkerResponse[] = [];
	#waiters: Array<() => void> = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>) => void
	>();

	postMessage(
		message:
			| OpenWorldObjectVisualAtlasWorkerRequest
			| OpenWorldObjectVisualAtlasWorkerResponse,
	): void {
		if (message.kind === "job" || message.kind === "cancel") {
			this.requests.push(message);
			return;
		}
		this.responses.push(message);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener:
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			  ) => void)
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			  ) => void),
	): void {
		this.#responseListeners.add(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			) => void,
		);
		this.#requestListeners.add(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			  ) => void)
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			  ) => void),
	): void {
		this.#responseListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			) => void,
		);
		this.#requestListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			) => void,
		);
	}

	emit(response: OpenWorldObjectVisualAtlasWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: OpenWorldObjectVisualAtlasWorkerRequest): void {
		const event = {
			data: request,
		} as MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>;
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

class AssetReadingFixtureAtlasBuilder implements OpenWorldObjectVisualAtlasBuilder {
	readonly #assetReader: PreparedAssetReader;

	constructor(assetReader: PreparedAssetReader) {
		this.#assetReader = assetReader;
	}

	async planAtlasPlacement(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasPlacementOutput> {
		const asset = await this.#assetReader.requestPreparedAsset({
			id: "prepared-texture/06000010",
			kind: "prepared-texture",
		});
		return {
			pages: [{ height: 1, pageId: `asset:${asset.sourceAssetId}`, width: 1 }],
			rects: [
				{
					entryKey:
						input.entries[0]?.entryId ??
						("entry:none" as OpenWorldTextureEntryId),
					pageId: `asset:${asset.sourceAssetId}`,
					rect: [0, 0, 1, 1],
				},
			],
			stageTimings: [
				{
					count: 1,
					durationMs: 1,
					stage: "texture-source-preparation",
				},
			],
		};
	}
}

function createLayoutInput(
	options: { readonly jobId?: string } = {},
): OpenWorldObjectVisualAtlasBuildInput {
	return {
		domain: "outdoor-terrain",
		entries: [
			{
				dataUse: createTextureUse(),
				entryId: "entry:terrain" as OpenWorldTextureEntryId,
				gutterEdgeMode: "clamp",
			},
		],
		jobId: options.jobId ?? "layout:terrain",
		page: {
			format: "rgba8",
			gutterEdgeMode: "clamp",
			gutterPixels: 0,
			height: 1,
			pageRunway: "none",
			pageSelection: "minimize-textures",
			width: 1,
		},
	};
}

function createPreparedTextureAsset(): PreparedAsset {
	return {
		key: { id: "prepared-texture/06000010", kind: "prepared-texture" },
		payload: {
			format: "rgba8",
			height: 1,
			kind: "prepared-texture",
			pixels: new Uint8Array([255, 128, 0, 255]),
			width: 1,
		},
		preparedAt: "test",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function createLayoutOutput(): OpenWorldObjectVisualAtlasPlacementOutput {
	return {
		pages: [{ height: 1, pageId: "layout:terrain:page:0", width: 1 }],
		rects: [
			{
				entryKey: "entry:terrain" as OpenWorldTextureEntryId,
				pageId: "layout:terrain:page:0",
				rect: [0, 0, 1, 1],
			},
		],
		stageTimings: [],
	};
}

function createTextureUse(): PreparedRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function createUnusedAssetReader(): PreparedAssetReader {
	return {
		requestPreparedAsset(): Promise<never> {
			throw new Error("Fixture asset reader should not be used.");
		},
	};
}
