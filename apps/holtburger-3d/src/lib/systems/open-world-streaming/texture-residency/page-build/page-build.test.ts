import { describe, expect, it } from "vitest";

import type { TextureBindingId } from "../../../../textures/identity";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildWorkerPort,
	OpenWorldTexturePageBuildWorkerRequest,
	OpenWorldTexturePageBuildWorkerResponse,
} from "./protocol";
import { WorkerPoolOpenWorldTexturePageBuilder } from "./worker-client";
import { installOpenWorldTexturePageBuildWorkerHandler } from "./worker-handler";
import { createOpenWorldTextureBucketKey } from "../claims/bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTexturePageId,
} from "../claims/texture-claim-registry";
import { settleOpenWorldTexturePageBuildResult } from "./page-build-results";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type {
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";

describe("open-world texture page build", () => {
	it("dispatches replacement-native page build jobs through the worker pool", async () => {
		const port = new FixturePageBuildWorkerPort();
		const builder = new WorkerPoolOpenWorldTexturePageBuilder({
			createWorker: () => port,
			workerCount: 1,
		});
		const input = createPageBuildInput();
		const result = builder.buildPage(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "job",
				requestId: "open-world-texture-page-build:0",
			},
		]);
		expect(JSON.stringify(port.requests[0])).not.toContain("placementRevision");

		port.emit({
			kind: "result",
			output: createPageBuildOutput(input),
			requestId: "open-world-texture-page-build:0",
		});

		await expect(result).resolves.toMatchObject({
			bucketKey: input.bucketKey,
			kind: "page-update",
			pageId: input.pageId,
			reservationToken: input.reservationToken,
		});
		builder.dispose();
	});

	it("exposes page build queue diagnostics from the worker pool", () => {
		const port = new FixturePageBuildWorkerPort();
		const builder = new WorkerPoolOpenWorldTexturePageBuilder({
			createWorker: () => port,
			workerCount: 1,
		});

		const firstBuild = builder.buildPage(
			createPageBuildInput({ jobId: "page-build:first" }),
		);
		const secondBuild = builder.buildPage(
			createPageBuildInput({ jobId: "page-build:second" }),
		);
		void firstBuild.catch(() => undefined);
		void secondBuild.catch(() => undefined);

		expect(builder.createDiagnosticsSnapshot()).toMatchObject({
			activeJobs: [
				{
					description: {
						label: "open-world-texture-page-build",
						taskId: "page-build:first",
					},
					stage: "running",
				},
			],
			queuedJobs: [
				{
					description: {
						label: "open-world-texture-page-build",
						taskId: "page-build:second",
					},
					stage: "queued",
				},
			],
			submittedJobs: 2,
			workerCount: 1,
		});
		builder.dispose();
	});

	it("runs page builds in the worker handler and transfers page pixels", async () => {
		const port = new FixturePageBuildWorkerPort();
		installOpenWorldTexturePageBuildWorkerHandler(
			{
				async buildPage(
					input: OpenWorldTexturePageBuildInput,
				): Promise<OpenWorldTexturePageBuildOutput> {
					return createPageBuildOutput(input);
				},
			},
			port,
		);
		const input = createPageBuildInput();

		port.emitRequest({
			input,
			kind: "job",
			requestId: "open-world-texture-page-build:9",
		});
		await port.waitForResponses(1);

		expect(port.responses[0]).toMatchObject({
			kind: "result",
			output: {
				kind: "page-update",
				pageId: input.pageId,
				reservationToken: input.reservationToken,
			},
			requestId: "open-world-texture-page-build:9",
		});
		const response = port.responses[0];
		if (response?.kind !== "result" || response.output.kind !== "page-update") {
			throw new Error("Expected page-update response.");
		}
		expect(port.transfers).toEqual([[response.output.page.pixels.buffer]]);
	});

	it("turns page builder failures into standard worker errors", async () => {
		const port = new FixturePageBuildWorkerPort();
		installOpenWorldTexturePageBuildWorkerHandler(
			{
				async buildPage(): Promise<OpenWorldTexturePageBuildOutput> {
					throw new Error("page source missing");
				},
			},
			port,
		);

		port.emitRequest({
			input: createPageBuildInput(),
			kind: "job",
			requestId: "open-world-texture-page-build:10",
		});
		await port.waitForResponses(1);

		expect(port.responses).toEqual([
			{
				kind: "error",
				message: "page source missing",
				requestId: "open-world-texture-page-build:10",
				stack: expect.any(String) as string,
			},
		]);
	});

	it("settles stale page build results without producing commits", () => {
		const { registry, input, pageId } = createReservedRegistryPage();
		const staleToken = input.reservationToken;
		const currentToken = registry.reservePageBuild(pageId);

		const settlement = settleOpenWorldTexturePageBuildResult(
			registry,
			createPageBuildOutput({ ...input, reservationToken: staleToken }),
		);

		expect(settlement).toEqual({ kind: "stale" });
		expect(
			registry.createBucketSnapshot(input.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: currentToken,
			state: "building",
		});
	});

	it("settles accepted page updates into texture commits", () => {
		const { registry, input } = createReservedRegistryPage();

		const settlement = settleOpenWorldTexturePageBuildResult(
			registry,
			createPageBuildOutput(input),
		);

		expect(settlement).toMatchObject({
			commit: {
				bindingUpdates: [
					{
						bindingId: bindingId("binding:terrain"),
						readiness: {
							kind: "resident",
							rect: [0, 0, 1, 1],
							textureRefId: "texture-ref:terrain",
						},
					},
				],
				pageUpdates: [
					{
						pageId: input.pageId,
						reservationToken: input.reservationToken,
						textureRefId: "texture-ref:terrain",
						uploadBindingId: bindingId("binding:terrain"),
					},
				],
				kind: "texture-commit",
			},
			kind: "accepted",
		});
		expect(
			registry.createBucketSnapshot(input.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: null,
			state: "resident",
		});
	});

	it("settles accepted noops without texture commits", () => {
		const { registry, input } = createReservedRegistryPage();

		const settlement = settleOpenWorldTexturePageBuildResult(registry, {
			bucketKey: input.bucketKey,
			jobId: input.jobId,
			kind: "noop",
			pageId: input.pageId,
			reason: "page already resident",
			reservationToken: input.reservationToken,
		});

		expect(settlement).toEqual({ commit: null, kind: "accepted" });
		expect(
			registry.createBucketSnapshot(input.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: null,
			state: "planned",
		});
	});
});

class FixturePageBuildWorkerPort implements OpenWorldTexturePageBuildWorkerPort {
	readonly requests: OpenWorldTexturePageBuildWorkerRequest[] = [];
	readonly responses: OpenWorldTexturePageBuildWorkerResponse[] = [];
	readonly transfers: readonly Transferable[][] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<OpenWorldTexturePageBuildWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<OpenWorldTexturePageBuildWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message:
			| OpenWorldTexturePageBuildWorkerRequest
			| OpenWorldTexturePageBuildWorkerResponse,
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
			| ((event: MessageEvent<OpenWorldTexturePageBuildWorkerResponse>) => void)
			| ((event: MessageEvent<OpenWorldTexturePageBuildWorkerRequest>) => void),
	): void {
		this.#responseListeners.add(
			listener as (
				event: MessageEvent<OpenWorldTexturePageBuildWorkerResponse>,
			) => void,
		);
		this.#requestListeners.add(
			listener as (
				event: MessageEvent<OpenWorldTexturePageBuildWorkerRequest>,
			) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<OpenWorldTexturePageBuildWorkerResponse>) => void)
			| ((event: MessageEvent<OpenWorldTexturePageBuildWorkerRequest>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldTexturePageBuildWorkerResponse>,
			) => void,
		);
		this.#requestListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldTexturePageBuildWorkerRequest>,
			) => void,
		);
	}

	emit(response: OpenWorldTexturePageBuildWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<OpenWorldTexturePageBuildWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: OpenWorldTexturePageBuildWorkerRequest): void {
		const event = {
			data: request,
		} as MessageEvent<OpenWorldTexturePageBuildWorkerRequest>;
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

function createReservedRegistryPage(): {
	readonly input: OpenWorldTexturePageBuildInput;
	readonly pageId: OpenWorldTexturePageId;
	readonly registry: OpenWorldTextureClaimRegistry;
} {
	const registry = new OpenWorldTextureClaimRegistry();
	const bucketKey = createBucketKey();
	const snapshot = registry.retainTextureBindings(
		ownerId("owner:terrain"),
		bucketKey,
		[
			{
				bindingId: bindingId("binding:terrain"),
				bucketKey,
				pageClass: pageClass("page-class:terrain"),
				purpose: "terrain-color",
				sourceKey: "source:terrain",
				textureKey: textureKey("texture:terrain"),
			},
		],
	);
	const page = registry.createPage({
		bucketKey,
		entryIds: [snapshot.entries[0].id],
	});
	const reservationToken = registry.reservePageBuild(page.id);
	return {
		input: createPageBuildInput({
			bucketKey,
			pageId: page.id,
			reservationToken,
		}),
		pageId: page.id,
		registry,
	};
}

function createPageBuildInput(
	options: Partial<OpenWorldTexturePageBuildInput> = {},
): OpenWorldTexturePageBuildInput {
	return {
		bucketKey: options.bucketKey ?? createBucketKey(),
		entries: [
			{
				bindingIds: [bindingId("binding:terrain")],
				entryId:
					"entry:terrain" as OpenWorldTexturePageBuildInput["entries"][number]["entryId"],
				gutterEdgeMode: "clamp",
				gutterPixels: 0,
				rect: [0, 0, 1, 1],
				source: {
					format: "rgba8",
					height: 1,
					kind: "open-world-texture-page-build-pixel-source",
					pixels: new Uint8Array([255, 128, 0, 255]),
					width: 1,
				},
			},
		],
		jobId: options.jobId ?? "page-build:terrain",
		page: {
			anisotropy: 1,
			filteringMode: "nearest",
			format: "rgba8",
			height: 1,
			mipmapsGenerated: false,
			sampleClass: "rgba-color",
			samplerPolicyKey: "nearest:clamp",
			width: 1,
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		},
		pageId:
			options.pageId ??
			("page:terrain" as OpenWorldTexturePageBuildInput["pageId"]),
		reservationToken:
			options.reservationToken ??
			("reservation:terrain" as OpenWorldTexturePageBuildInput["reservationToken"]),
	};
}

function createPageBuildOutput(
	input: OpenWorldTexturePageBuildInput,
): OpenWorldTexturePageBuildOutput {
	return {
		bucketKey: input.bucketKey,
		jobId: input.jobId,
		kind: "page-update",
		page: {
			...input.page,
			pixels: new Uint8Array([255, 128, 0, 255]),
			textureRefId: "texture-ref:terrain",
		},
		pageId: input.pageId,
		placements: [
			{
				bindingId: bindingId("binding:terrain"),
				rect: [0, 0, 1, 1],
			},
		],
		reservationToken: input.reservationToken,
	};
}

function createBucketKey(): ReturnType<typeof createOpenWorldTextureBucketKey> {
	return createOpenWorldTextureBucketKey({
		domain: "outdoor-terrain",
		purpose: "terrain-color",
		scope: { kind: "static-domain" },
	});
}

function bindingId(value: string): TextureBindingId {
	return value as TextureBindingId;
}

function ownerId(value: string): MaterializationOwnerId {
	return value as MaterializationOwnerId;
}

function pageClass(value: string): TexturePageClass {
	return value as TexturePageClass;
}

function textureKey(value: string): TextureKey {
	return value as TextureKey;
}
