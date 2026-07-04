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
	DynamicVisualRecipeWorkerMainMessage,
	DynamicVisualRecipeWorkerPort,
	DynamicVisualRecipeWorkerRequestPayload,
	DynamicVisualRecipeWorkerThreadMessage,
} from "./visual-recipe-protocol";
import type { DynamicVisualRecipeResolutionRequest } from "./visual-recipe-resolver";
import { WorkerPoolDynamicVisualRecipeResolver } from "./visual-recipe-worker-client";
import { installDynamicVisualRecipeWorkerHandler } from "./visual-recipe-worker-handler";

describe("dynamic visual recipe worker protocol", () => {
	it("posts standard runtime-authored recipe requests without main-thread asset readers", async () => {
		const port = new FixtureWorkerPort();
		const assetReader = new FixturePreparedAssetReader(
			new Error("test should not use main-thread reader"),
		);
		const resolver = new WorkerPoolDynamicVisualRecipeResolver({
			assetReader,
			createWorker: () => port,
			workerCount: 1,
		});
		const request = createResolutionRequest();
		const recipe = createRecipe(request);
		const pending = resolver.resolveRecipe(request);

		expect(port.requests).toEqual([
			{
				input: createWorkerRequest(request),
				kind: "job",
				requestId: "dynamic-visual-recipe:0",
			},
		]);

		port.emit({
			kind: "result",
			output: recipe,
			requestId: "dynamic-visual-recipe:0",
		});

		await expect(pending).resolves.toBe(recipe);
		resolver.dispose();
	});

	it("routes prepared asset service requests through the pool service handler", async () => {
		const port = new FixtureWorkerPort();
		const key = createHostAssetKey("render-surface", 0x06000010);
		const asset = createPreparedAsset(key, {
			kind: "render-surface",
			sourceBytes: new Uint8Array([1, 2, 3, 4]),
		});
		const assetReader = new FixturePreparedAssetReader(asset);
		const resolver = new WorkerPoolDynamicVisualRecipeResolver({
			assetReader,
			createWorker: () => port,
			workerCount: 1,
		});

		void resolver.resolveRecipe(createResolutionRequest());
		port.emit({
			kind: "service-request",
			request: { key, kind: "prepared-asset" },
			requestId: "dynamic-visual-recipe:0",
			serviceRequestId: "dynamic-service:1",
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(assetReader.requests).toEqual([key]);
		expect(port.requests.at(-1)).toMatchObject({
			kind: "service-response",
			response: {
				asset: {
					key,
					payload: expect.not.objectContaining({
						sourceBytes: expect.any(Uint8Array),
					}) as PreparedAsset["payload"],
				},
			},
			serviceRequestId: "dynamic-service:1",
		});
		expect(asset.payload).toHaveProperty("sourceBytes");
	});

	it("turns resolver handler service failures into standard worker errors", async () => {
		const port = new FixtureWorkerPort();
		installDynamicVisualRecipeWorkerHandler(port);
		const request = createResolutionRequest();

		port.emitRequest({
			input: createWorkerRequest(request),
			kind: "job",
			requestId: "dynamic-recipe:failure",
		});
		await port.waitForResponses(1);
		expect(port.responses[0]).toMatchObject({
			kind: "service-request",
			requestId: "dynamic-recipe:failure",
		});

		const serviceRequest = port.responses[0];
		if (serviceRequest?.kind !== "service-request") {
			throw new Error("Expected service request.");
		}
		port.emitRequest({
			kind: "service-error",
			message: "setup asset missing",
			serviceRequestId: serviceRequest.serviceRequestId,
		});
		await port.waitForResponses(2);

		expect(port.responses[1]).toMatchObject({
			kind: "error",
			message: "setup asset missing",
			requestId: "dynamic-recipe:failure",
		});
	});
});

class FixtureWorkerPort implements DynamicVisualRecipeWorkerPort {
	readonly requests: DynamicVisualRecipeWorkerMainMessage[] = [];
	readonly responses: DynamicVisualRecipeWorkerThreadMessage[] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message:
			| DynamicVisualRecipeWorkerMainMessage
			| DynamicVisualRecipeWorkerThreadMessage,
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
			| ((event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void)
			| ((event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>) => void),
	): void {
		this.#responseListeners.add(
			listener as (
				event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
			) => void,
		);
		this.#requestListeners.add(
			listener as (
				event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>,
			) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>) => void)
			| ((event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (
				event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
			) => void,
		);
		this.#requestListeners.delete(
			listener as (
				event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>,
			) => void,
		);
	}

	emit(message: DynamicVisualRecipeWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<DynamicVisualRecipeWorkerThreadMessage>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(message: DynamicVisualRecipeWorkerMainMessage): void {
		const event = {
			data: message,
		} as MessageEvent<DynamicVisualRecipeWorkerMainMessage>;
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
): DynamicVisualRecipeWorkerRequestPayload {
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
		frame: {
			origin: { x: 0, y: 0, z: 0 },
			angles: { w: 1, x: 0, y: 0, z: 0 },
		},
		position: { x: 0, y: 0, z: 0 },
	};
}
