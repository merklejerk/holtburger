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
	PreparedRenderSurfaceTextureUseIdentity,
} from "../static/contracts";
import type { OpenWorldTextureEntryId } from "../systems/open-world-streaming/texture-residency/claims/texture-claim-registry";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas-builder";
import type {
	OpenWorldObjectVisualAtlasWorkerPort,
	OpenWorldObjectVisualAtlasWorkerRequest,
	OpenWorldObjectVisualAtlasWorkerResponse,
} from "../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas-worker-protocol";
import {
	createWorkerDynamicVisualBaker,
	createWorkerDynamicVisualRecipeResolver,
	createWorkerObjectVisualAtlasBuilder,
	createWorkerStaticResolver,
} from "./create-browser-runtime";

describe("browser runtime routing", () => {
	it("creates a static resolver worker pool", () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const createdWorkers = [
			new FixtureStaticResolverWorker(),
			new FixtureStaticResolverWorker(),
		];
		const pendingWorkers = [...createdWorkers];
		const resolver = createWorkerStaticResolver(
			assetReader,
			createdWorkers.length,
			{
				createWorker: () => {
					const worker = pendingWorkers.shift();
					if (!worker) {
						throw new Error("No fixture resolver worker left.");
					}
					return worker;
				},
			},
		);

		disposeResolver(resolver);
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
			createWorker: () => worker,
		});

		const pending = resolver.resolveSource(sourceRequest);

		expect(worker.messages).toEqual([
			{
				input: {
					kind: "resolve-landblock-scene-lod-source",
					sourceRequest,
				},
				kind: "job",
				requestId: "resolver-job:0",
			},
		]);
		expect(
			worker.messages.some(
				(message) =>
					message.kind === "job" &&
					message.input.kind === "resolve-static-scope",
			),
		).toBe(false);

		const resolution: StaticLandblockSceneLodResolution = {
			dynamicRecipes: [],
			recipes: [],
			request: sourceRequest,
		};
		worker.emit({
			kind: "result",
			output: {
				kind: "landblock-scene-lod-source-resolved",
				resolution,
			},
			requestId: "resolver-job:0",
		});

		await expect(pending).resolves.toBe(resolution);
		disposeResolver(resolver);
	});

	it("creates a dynamic visual recipe worker pool", () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const workers = [
			new FixtureDynamicVisualRecipeWorker(),
			new FixtureDynamicVisualRecipeWorker(),
		];
		const pendingWorkers = [...workers];
		const resolver = createWorkerDynamicVisualRecipeResolver(
			assetReader,
			workers.length,
			{
				createWorker: () => {
					const worker = pendingWorkers.shift();
					if (!worker) {
						throw new Error("No fixture dynamic visual recipe worker left.");
					}
					return worker;
				},
			},
		);

		disposeResolver(resolver);
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

	it("creates an object visual atlas worker pool for material layout", async () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const workers = [
			new FixtureObjectVisualAtlasWorker(),
			new FixtureObjectVisualAtlasWorker(),
		];
		const pendingWorkers = [...workers];
		const builder = createWorkerObjectVisualAtlasBuilder(
			assetReader,
			workers.length,
			{
				createWorker: () => {
					const worker = pendingWorkers.shift();
					if (!worker) {
						throw new Error("No fixture object visual atlas worker left.");
					}
					return worker;
				},
			},
		);
		const input = createAtlasInput();
		const pending = builder.planAtlasPlacement(input);

		expect(workers[0]?.messages).toEqual([
			{
				input,
				kind: "job",
				requestId: "open-world-texture-layout:0",
			},
		]);
		workers[0]?.emit({
			kind: "result",
			output: createAtlasOutput(),
			requestId: "open-world-texture-layout:0",
		});

		await expect(pending).resolves.toEqual(createAtlasOutput());
		disposeResolver(builder);
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

class FixtureObjectVisualAtlasWorker implements OpenWorldObjectVisualAtlasWorkerPort {
	readonly messages: OpenWorldObjectVisualAtlasWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>) => void
	>();
	terminated = false;

	postMessage(message: OpenWorldObjectVisualAtlasWorkerRequest): void {
		this.messages.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
		) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (
			event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
		) => void,
	): void {
		this.#listeners.delete(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: OpenWorldObjectVisualAtlasWorkerResponse): void {
		const event = {
			data: message,
		} as MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>;
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

function createAtlasInput(): OpenWorldObjectVisualAtlasBuildInput {
	return {
		domain: "outdoor-generated-scenery",
		entries: [
			{
				dataUse: createTextureUse(),
				entryId: "entry:object-base" as OpenWorldTextureEntryId,
				gutterEdgeMode: "clamp",
			},
		],
		jobId: "layout:object-base",
		page: {
			format: "rgba8",
			gutterEdgeMode: "clamp",
			gutterPixels: 1,
			height: 256,
			pageRunway: "one-tier",
			pageSelection: "minimize-textures",
			width: 256,
		},
	};
}

function createAtlasOutput(): OpenWorldObjectVisualAtlasPlacementOutput {
	return {
		pages: [{ height: 256, pageId: "layout:object-base:page:0", width: 256 }],
		rects: [
			{
				entryKey: "entry:object-base" as OpenWorldTextureEntryId,
				pageId: "layout:object-base:page:0",
				rect: [1, 1, 1, 1],
			},
		],
		stageTimings: [
			{
				count: 1,
				durationMs: 1,
				stage: "texture-layout",
			},
		],
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
