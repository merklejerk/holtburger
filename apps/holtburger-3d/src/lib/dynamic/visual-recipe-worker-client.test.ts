import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { createHostAssetKey, formatHostAssetId } from "../assets/keys";
import type {
	DynamicEntityRecipe,
	DynamicVisualMaterialPolicy,
} from "./contracts";
import { createDynamicVisualResourceId } from "./contracts";
import type {
	DynamicVisualRecipeWorkerGlobalPort,
	DynamicVisualRecipeWorkerMainMessage,
	DynamicVisualRecipeWorkerPort,
	DynamicVisualRecipeWorkerThreadMessage,
} from "./visual-recipe-protocol";
import type { DynamicVisualRecipeResolutionRequest } from "./visual-recipe-resolver";
import {
	createDynamicVisualRecipeMainAssetBridge,
	DynamicVisualRecipeWorkerClient,
} from "./visual-recipe-worker-client";
import { handleDynamicVisualRecipeWorkerRequest } from "./visual-recipe-worker-handler";

describe("dynamic visual recipe worker protocol", () => {
	it("posts runtime-authored recipe requests without main-thread asset readers", async () => {
		const port = new FixtureWorkerPort();
		const client = new DynamicVisualRecipeWorkerClient(port);
		const request = createResolutionRequest();
		const recipe = createRecipe(request);
		const pending = client.resolveRecipe(request);

		expect(port.requests).toEqual([
			{
				kind: "resolve-dynamic-visual-recipe",
				request: {
					animationSelection: request.animationSelection,
					baseTransform: request.baseTransform,
					entityId: request.entityId,
					materialPolicy: request.materialPolicy,
					modelData: request.modelData,
					setupModelId: request.setupModelId,
					source: request.source,
				},
				requestId: "dynamic-visual-recipe:0",
			},
		]);

		port.emit({
			kind: "dynamic-visual-recipe-resolved",
			recipe,
			requestId: "dynamic-visual-recipe:0",
		});

		await expect(pending).resolves.toBe(recipe);
		client.dispose();
	});

	it("turns resolver handler failures into typed worker responses", async () => {
		const responses: DynamicVisualRecipeWorkerThreadMessage[] = [];
		const request = createResolutionRequest();

		await handleDynamicVisualRecipeWorkerRequest(
			new FixturePreparedAssetReader(new Error("setup asset missing")),
			{
				kind: "resolve-dynamic-visual-recipe",
				request: createWorkerRequest(request),
				requestId: "dynamic-recipe:failure",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "dynamic-visual-recipe-resolve-failed",
				message: "setup asset missing",
				requestId: "dynamic-recipe:failure",
			},
		]);
	});

	it("round-trips prepared asset requests through the dynamic resolver bridge with resolver-light views", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("render-surface", 0x06000010);
		const asset = createPreparedAsset(key, {
			defaultPaletteId: 0x04000010,
			dependencies: { paletteAssetIds: ["palette/04000010"] },
			format: "p8",
			formatRaw: 0x29,
			height: 4,
			kind: "render-surface",
			provenance: {
				detail: null,
				errorCode: null,
				source: "repo-local-hba",
				sourceAssetKind: "render-surface",
			},
			renderSurfaceId: 0x06000010,
			residencyKind: "unknown",
			sourceAssetKind: "render-surface",
			sourceByteLength: 16,
			sourceBytes: new Uint8Array([1, 2, 3, 4]),
			unknown: 0,
			width: 4,
		});
		const reader = new FixturePreparedAssetReader(asset);
		const bridge = createDynamicVisualRecipeMainAssetBridge(
			channel.mainPort,
			reader,
		);

		channel.workerPort.postMessage({
			key,
			kind: "prepared-asset-requested",
			requestId: "dynamic-asset:1",
		});
		await Promise.resolve();

		expect(reader.requests).toEqual([key]);
		expect(channel.mainMessages).toEqual([
			{
				asset: expect.objectContaining({
					key,
					payload: expect.not.objectContaining({
						sourceBytes: expect.any(Uint8Array),
					}),
				}),
				kind: "prepared-asset-request-resolved",
				requestId: "dynamic-asset:1",
			},
		]);
		expect(asset.payload).toHaveProperty("sourceBytes");
		bridge.dispose();
	});
});

class FixtureWorkerPort implements DynamicVisualRecipeWorkerPort {
	readonly requests: DynamicVisualRecipeWorkerMainMessage[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void
	>();

	postMessage(message: DynamicVisualRecipeWorkerMainMessage): void {
		this.requests.push(message);
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

	emit(response: DynamicVisualRecipeWorkerThreadMessage): void {
		const event = {
			data: response,
		} as MessageEvent<DynamicVisualRecipeWorkerThreadMessage>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

class FixtureWorkerChannel {
	readonly mainMessages: DynamicVisualRecipeWorkerMainMessage[] = [];
	readonly #mainListeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void
	>();
	readonly #workerListeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>) => void
	>();

	readonly mainPort: DynamicVisualRecipeWorkerPort = {
		addEventListener: (_type, listener) => {
			this.#mainListeners.add(listener);
		},
		postMessage: (message) => {
			this.mainMessages.push(message);
			this.#emitWorkerMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#mainListeners.delete(listener);
		},
	};

	readonly workerPort: DynamicVisualRecipeWorkerGlobalPort = {
		addEventListener: (_type, listener) => {
			this.#workerListeners.add(listener);
		},
		postMessage: (message) => {
			this.#emitThreadMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#workerListeners.delete(listener);
		},
	};

	#emitThreadMessage(message: DynamicVisualRecipeWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<DynamicVisualRecipeWorkerThreadMessage>;
		for (const listener of this.#mainListeners) {
			listener(event);
		}
	}

	#emitWorkerMessage(message: DynamicVisualRecipeWorkerMainMessage): void {
		const event = {
			data: message,
		} as MessageEvent<DynamicVisualRecipeWorkerMainMessage>;
		for (const listener of this.#workerListeners) {
			listener(event);
		}
	}
}

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly requests: HostAssetKey[] = [];

	constructor(private readonly result: PreparedAsset | Error) {}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requests.push(key);
		if (this.result instanceof Error) {
			return Promise.reject(this.result);
		}

		return Promise.resolve(this.result);
	}
}

function createResolutionRequest(): DynamicVisualRecipeResolutionRequest {
	const entityId = "runtime:worker:1";
	return {
		animationSelection: { kind: "none" },
		assetReader: new FixturePreparedAssetReader(
			new Error("test should not use main-thread reader"),
		),
		baseTransform: {
			baseLocalPlacement: createPlacement(),
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		entityId,
		materialPolicy: createMaterialPolicy(entityId),
		modelData: null,
		setupModelId: 0x020003e5,
		source: {
			kind: "runtime-authored",
			runtimeEntityId: entityId,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
	};
}

function createWorkerRequest(
	request: DynamicVisualRecipeResolutionRequest,
): Omit<DynamicVisualRecipeResolutionRequest, "assetReader"> {
	return {
		animationSelection: request.animationSelection,
		baseTransform: request.baseTransform,
		entityId: request.entityId,
		materialPolicy: request.materialPolicy,
		modelData: request.modelData,
		setupModelId: request.setupModelId,
		source: request.source,
	};
}

function createRecipe(
	request: DynamicVisualRecipeResolutionRequest,
): DynamicEntityRecipe {
	return {
		animationSelection: request.animationSelection,
		baseTransform: request.baseTransform,
		entityId: request.entityId,
		source: request.source,
		visual: {
			animation: null,
			materialPolicy: request.materialPolicy,
			materialSources: [],
			missingRefs: [],
			paletteSources: [],
			setupModel: {
				geometries: [],
				identity: {
					sourceAssetKind: "setup-model",
					sourceDid: request.setupModelId,
				},
				locationType: "setup-model-default",
				parts: [],
			},
			sourceAssets: [],
			textureRefs: [],
		},
	};
}

function createMaterialPolicy(entityId: string): DynamicVisualMaterialPolicy {
	return {
		detailRolePolicy: {
			kind: "runtime-authored-none",
		},
		materialPlanningDomain: "outdoor-explicit-objects",
		visualObject: {
			entityId,
			kind: "dynamic-visual-object",
			resourceId: createDynamicVisualResourceId(entityId),
		},
	};
}

function createPreparedAsset(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-30T00:00:00.000Z",
		revision: 1,
		sourceAssetId: formatHostAssetId(key),
	};
}

function createPlacement() {
	return {
		orientation: {
			w: 1,
			x: 0,
			y: 0,
			z: 0,
		},
		origin: {
			x: 0,
			y: 0,
			z: 0,
		},
	};
}
