import { describe, expect, it } from "vitest";
import type { PreparedAssetReader } from "../assets/contracts";
import type {
	DynamicVisualBakeWorkerMainMessage,
	DynamicVisualBakeWorkerPort,
	DynamicVisualBakeWorkerThreadMessage,
} from "../dynamic/visual-bake-protocol";
import type {
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "../static/resolver/protocol";
import type {
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
} from "../static/contracts";
import {
	createWorkerDynamicVisualBaker,
	createWorkerStaticResolver,
	shouldUseBrowserWorkerBaker,
} from "./create-browser-runtime";

describe("browser runtime routing", () => {
	it("routes split outdoor object domains through worker baking", () => {
		for (const domain of [
			"outdoor-explicit-objects",
			"outdoor-generated-scenery",
		] as const) {
			expect(shouldUseBrowserWorkerBaker(domain)).toBe(true);
		}
	});

	it("routes env-cell bundles through worker baking", () => {
		expect(shouldUseBrowserWorkerBaker("env-cell-system")).toBe(true);
	});

	it("backs static resolver worker bridges with the supplied asset reader", () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const createdWorkers = [
			new FixtureStaticResolverWorker(),
			new FixtureStaticResolverWorker(),
		];
		const pendingWorkers = [...createdWorkers];
		const bridgedReaders: PreparedAssetReader[] = [];
		let disposedBridges = 0;
		const resolver = createWorkerStaticResolver(
			assetReader,
			createdWorkers.length,
			{
				createBridge: (_port, bridgedAssetReader) => {
					bridgedReaders.push(bridgedAssetReader);
					return {
						dispose: () => {
							disposedBridges += 1;
						},
					};
				},
				createWorker: () => {
					const worker = pendingWorkers.shift();
					if (!worker) {
						throw new Error("No fixture resolver worker left.");
					}
					return worker;
				},
			},
		);

		expect(bridgedReaders).toEqual([assetReader, assetReader]);
		disposeResolver(resolver);
		expect(disposedBridges).toBe(2);
		expect(createdWorkers.map((worker) => worker.terminated)).toEqual([
			true,
			true,
		]);
	});

	it("posts source-first worker requests without old direct static-scope jobs", async () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const worker = new FixtureStaticResolverWorker();
		const sourceRequest = createSourceRequest();
		const resolver = createWorkerStaticResolver(assetReader, 1, {
			createBridge: () => ({ dispose: () => {} }),
			createWorker: () => worker,
		});

		const pending = resolver.resolveSource(sourceRequest);

		expect(worker.messages).toEqual([
			{
				kind: "resolve-landblock-scene-lod-source",
				requestId: "resolver-source:0",
				sourceRequest,
			},
		]);
		expect(
			worker.messages.some(
				(message) => message.kind === "resolve-static-scope",
			),
		).toBe(false);

		const resolution: StaticLandblockSceneLodResolution = {
			recipes: [],
			request: sourceRequest,
		};
		worker.emit({
			kind: "landblock-scene-lod-source-resolved",
			requestId: "resolver-source:0",
			resolution,
		});

		await expect(pending).resolves.toBe(resolution);
		disposeResolver(resolver);
	});

	it("creates a separate dynamic visual bake worker pool", async () => {
		const workers = [
			new FixtureDynamicVisualBakeWorker(),
			new FixtureDynamicVisualBakeWorker(),
		];
		const pendingWorkers = [...workers];
		const baker = createWorkerDynamicVisualBaker(workers.length, {
			createWorker: () => {
				const worker = pendingWorkers.shift();
				if (!worker) {
					throw new Error("No fixture dynamic visual bake worker left.");
				}
				return worker;
			},
		});

		const pending = baker.bake({
			batchId: "dynamic-visual-batch:test",
			recipes: [],
			revision: 1,
			sourceGeometry: [],
		});

		expect(workers[0]?.messages).toEqual([
			{
				input: {
					batchId: "dynamic-visual-batch:test",
					recipes: [],
					revision: 1,
					sourceGeometry: [],
				},
				kind: "bake-dynamic-visual-batch",
				requestId: "dynamic-visual-bake:0",
			},
		]);
		workers[0]?.emit({
			kind: "dynamic-visual-batch-baked",
			requestId: "dynamic-visual-bake:0",
			result: {
				batchId: "dynamic-visual-batch:test",
				failures: [],
				products: [],
				revision: 1,
			},
		});

		await expect(pending).resolves.toMatchObject({
			batchId: "dynamic-visual-batch:test",
		});
		disposeResolver(baker);
		expect(workers.map((worker) => worker.terminated)).toEqual([true, true]);
	});
});

class FixtureStaticResolverWorker implements StaticResolverWorkerPort {
	readonly messages: StaticResolverWorkerMainMessage[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<StaticResolverWorkerThreadMessage>) => void
	>();
	terminated = false;

	postMessage(message: StaticResolverWorkerMainMessage): void {
		this.messages.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerThreadMessage>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerThreadMessage>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: StaticResolverWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<StaticResolverWorkerThreadMessage>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

class FixtureDynamicVisualBakeWorker implements DynamicVisualBakeWorkerPort {
	readonly messages: DynamicVisualBakeWorkerMainMessage[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>) => void
	>();
	terminated = false;

	postMessage(message: DynamicVisualBakeWorkerMainMessage): void {
		this.messages.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>,
		) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>,
		) => void,
	): void {
		this.#listeners.delete(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: DynamicVisualBakeWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<DynamicVisualBakeWorkerThreadMessage>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function disposeResolver(resolver: unknown): void {
	if (
		typeof resolver !== "object" ||
		resolver === null ||
		!("dispose" in resolver) ||
		typeof resolver.dispose !== "function"
	) {
		throw new Error("Expected resolver to expose dispose().");
	}

	resolver.dispose();
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
			{
				kind: "outdoor-generated-scenery",
				targetOwnerKey: {
					kind: "outdoor-generated-scenery",
					landblockId: 0xda55ffff,
				},
			},
		],
		sourceLod: 3,
	};
}
