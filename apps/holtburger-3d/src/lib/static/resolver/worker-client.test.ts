import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import type {
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import type {
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerPort,
	StaticResolverWorkerResponse,
	StaticResolverWorkerThreadMessage,
} from "./protocol";
import { StaticResolverWorkerClient } from "./worker-client";
import { installStaticResolverWorkerHandler } from "./worker-handler";

describe("static resolver worker protocol", () => {
	it("posts standard static scope requests and resolves returned payloads", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticResolverWorkerClient(
			port,
			new FixturePreparedAssetReader(),
		);
		const job = createJob();
		const pending = client.resolve(job);

		expect(port.requests).toEqual([
			{
				input: {
					job,
					kind: "resolve-static-scope",
				},
				kind: "job",
				requestId: "resolver-job:0",
			},
		]);

		port.emit({
			kind: "result",
			output: {
				kind: "static-scope-resolved",
				payload: createPayload(job),
			},
			requestId: "resolver-job:0",
		});

		await expect(pending).resolves.toMatchObject({
			job,
			scope: { kind: "placeholder" },
		});
		client.dispose();
	});

	it("turns resolver handler failures into standard worker errors", async () => {
		const job = createJob();
		const port = new FixtureWorkerPort();
		installStaticResolverWorkerHandler(
			() => ({
				async resolve(): Promise<StaticScopePayload> {
					throw new Error("missing terrain root");
				},
			}),
			port,
		);

		port.emitRequest({
			input: {
				job,
				kind: "resolve-static-scope",
			},
			kind: "job",
			requestId: "transport:1",
		});
		await port.waitForResponses(1);

		expect(port.responses[0]).toMatchObject({
			kind: "error",
			message: "missing terrain root",
			requestId: "transport:1",
		});
	});

	it("posts source-first requests and resolves multi-recipe responses", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticResolverWorkerClient(
			port,
			new FixturePreparedAssetReader(),
		);
		const sourceRequest = createSourceRequest();
		const resolution = createSourceResolution(sourceRequest);
		const pending = client.resolveSource(sourceRequest);

		expect(port.requests).toEqual([
			{
				input: {
					kind: "resolve-landblock-scene-lod-source",
					sourceRequest,
				},
				kind: "job",
				requestId: "resolver-job:0",
			},
		]);

		port.emit({
			kind: "result",
			output: {
				kind: "landblock-scene-lod-source-resolved",
				resolution,
			},
			requestId: "resolver-job:0",
		});

		await expect(pending).resolves.toBe(resolution);
		client.dispose();
	});

	it("handles source-first worker requests with source-capable resolvers", async () => {
		const sourceRequest = createSourceRequest();
		const resolution = createSourceResolution(sourceRequest);
		const port = new FixtureWorkerPort();
		installStaticResolverWorkerHandler(
			() => ({
				async resolve(): Promise<StaticScopePayload> {
					throw new Error("static-scope path should not run");
				},
				async resolveSource(): Promise<StaticLandblockSceneLodResolution> {
					return resolution;
				},
			}),
			port,
		);

		port.emitRequest({
			input: {
				kind: "resolve-landblock-scene-lod-source",
				sourceRequest,
			},
			kind: "job",
			requestId: "transport:source",
		});
		await port.waitForResponses(1);

		expect(port.responses).toEqual([
			{
				kind: "result",
				output: {
					kind: "landblock-scene-lod-source-resolved",
					resolution,
				},
				requestId: "transport:source",
			},
		]);
	});

	it("constructs a fresh resolver for each static scope request", async () => {
		const job = createJob();
		const port = new FixtureWorkerPort();
		let resolverCount = 0;
		installStaticResolverWorkerHandler(() => {
			resolverCount += 1;
			return {
				async resolve(): Promise<StaticScopePayload> {
					return createPayload(job);
				},
			};
		}, port);

		port.emitRequest({
			input: {
				job,
				kind: "resolve-static-scope",
			},
			kind: "job",
			requestId: "transport:1",
		});
		await port.waitForResponses(1);
		port.emitRequest({
			input: {
				job,
				kind: "resolve-static-scope",
			},
			kind: "job",
			requestId: "transport:2",
		});
		await port.waitForResponses(2);

		expect(resolverCount).toBe(2);
		expect(port.responses).toHaveLength(2);
	});
});

class FixtureWorkerPort implements StaticResolverWorkerPort {
	readonly requests: StaticResolverWorkerMainMessage[] = [];
	readonly responses: StaticResolverWorkerThreadMessage[] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerMainMessage>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message:
			| StaticResolverWorkerMainMessage
			| StaticResolverWorkerThreadMessage,
	): void {
		if (
			message.kind === "job" ||
			message.kind === "cancel" ||
			message.kind === "service-response" ||
			message.kind === "service-error"
		) {
			this.requests.push(message);
			return;
		}
		this.responses.push(message);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<StaticResolverWorkerResponse>) => void)
			| ((event: MessageEvent<StaticResolverWorkerMainMessage>) => void),
	): void {
		this.#responseListeners.add(
			listener as (event: MessageEvent<StaticResolverWorkerResponse>) => void,
		);
		this.#requestListeners.add(
			listener as (
				event: MessageEvent<StaticResolverWorkerMainMessage>,
			) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<StaticResolverWorkerResponse>) => void)
			| ((event: MessageEvent<StaticResolverWorkerMainMessage>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (event: MessageEvent<StaticResolverWorkerResponse>) => void,
		);
		this.#requestListeners.delete(
			listener as (
				event: MessageEvent<StaticResolverWorkerMainMessage>,
			) => void,
		);
	}

	emit(response: StaticResolverWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<StaticResolverWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: StaticResolverWorkerMainMessage): void {
		const event = {
			data: request,
		} as MessageEvent<StaticResolverWorkerMainMessage>;
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

class FixturePreparedAssetReader implements PreparedAssetReader {
	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		return Promise.reject(new Error(`Unexpected asset request ${key.id}.`));
	}
}

function createJob(): StaticResolverJob {
	return {
		domain: "outdoor-terrain",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createPayload(job: StaticResolverJob): StaticScopePayload {
	return {
		job,
		scope: {
			kind: "placeholder",
			referencedTextureUses: [],
		},
		sourceRevision: 1,
	};
}

function createSourceRequest(): StaticLandblockSceneLodSourceRequest {
	return {
		context: "outdoor",
		landblockId: 0xda55ffff,
		requestedLayers: [
			{
				kind: "terrain",
				targetOwnerKey: {
					kind: "terrain",
					landblockId: 0xda55ffff,
				},
			},
		],
		sourceLod: 0,
	};
}

function createSourceResolution(
	request: StaticLandblockSceneLodSourceRequest,
): StaticLandblockSceneLodResolution {
	const job = createJob();
	return {
		dynamicRecipes: [],
		recipes: [
			{
				payload: createPayload(job),
				targetOwnerKey: {
					kind: "terrain",
					landblockId: 0xda55ffff,
				},
			},
		],
		request,
	};
}
