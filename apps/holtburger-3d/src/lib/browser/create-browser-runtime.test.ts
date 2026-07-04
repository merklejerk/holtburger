import { describe, expect, it } from "vitest";
import type { PreparedAssetReader } from "../assets/contracts";
import type {
	DynamicVisualBakeWorkerMainMessage,
	DynamicVisualBakeWorkerPort,
	DynamicVisualBakeWorkerThreadMessage,
} from "../dynamic/visual-bake-protocol";
import type { DynamicVisualBakeInput } from "../dynamic/contracts";
import type {
	DynamicVisualRecipeWorkerMainMessage,
	DynamicVisualRecipeWorkerPort,
	DynamicVisualRecipeWorkerThreadMessage,
} from "../dynamic/visual-recipe-protocol";
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
	createWorkerDynamicVisualRecipeResolver,
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
			dynamicRecipes: [],
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

	it("backs dynamic visual recipe resolver workers with the supplied asset reader", () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const workers = [
			new FixtureDynamicVisualRecipeWorker(),
			new FixtureDynamicVisualRecipeWorker(),
		];
		const pendingWorkers = [...workers];
		const bridgedReaders: PreparedAssetReader[] = [];
		let disposedBridges = 0;
		const resolver = createWorkerDynamicVisualRecipeResolver(
			assetReader,
			workers.length,
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
						throw new Error("No fixture dynamic visual recipe worker left.");
					}
					return worker;
				},
			},
		);

		expect(bridgedReaders).toEqual([assetReader, assetReader]);
		disposeResolver(resolver);
		expect(disposedBridges).toBe(2);
		expect(workers.map((worker) => worker.terminated)).toEqual([true, true]);
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

		const input = createDynamicVisualBakeInput("dynamic-visual:test");
		const pending = baker.bake(input);

		expect(workers[0]?.messages).toEqual([
			{
				input,
				kind: "job",
				requestId: "dynamic-visual-bake:0",
			},
		]);
		workers[0]?.emit({
			kind: "result",
			output: {
				failures: [],
				product: null,
				revision: 1,
			},
			requestId: "dynamic-visual-bake:0",
		});

		await expect(pending).resolves.toMatchObject({
			revision: 1,
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

class FixtureDynamicVisualRecipeWorker implements DynamicVisualRecipeWorkerPort {
	readonly messages: DynamicVisualRecipeWorkerMainMessage[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void
	>();
	terminated = false;

	postMessage(message: DynamicVisualRecipeWorkerMainMessage): void {
		this.messages.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
		) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
		) => void,
	): void {
		this.#listeners.delete(listener);
	}

	terminate(): void {
		this.terminated = true;
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

function createDynamicVisualBakeInput(
	entityId: string,
): DynamicVisualBakeInput {
	return {
		recipe: { entityId } as DynamicVisualBakeInput["recipe"],
		revision: 1,
		sourceGeometry: [],
		texturePlacementSnapshot: {
			itemIdsByBindingId: new Map(),
			placementsByBindingId: new Map(),
			placementsByItemId: new Map(),
		},
		texturePlanning: {
			entityId,
			materialPlan: null,
			placementIntents: [],
			textureRequirements: [],
		},
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
