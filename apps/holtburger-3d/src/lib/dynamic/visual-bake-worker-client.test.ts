import { describe, expect, it } from "vitest";
import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
	DynamicEntityRenderPart,
} from "./contracts";
import type {
	DynamicVisualBakeWorkerPort,
	DynamicVisualBakeWorkerRequest,
	DynamicVisualBakeWorkerResponse,
} from "./visual-bake-protocol";
import { WorkerPoolDynamicVisualBaker } from "./visual-bake-worker-client";
import { installDynamicVisualBakeWorkerHandler } from "./visual-bake-worker-handler";

describe("dynamic visual bake worker protocol", () => {
	it("turns baker handler failures into standard worker errors", async () => {
		const port = new FixtureWorkerPort();
		installDynamicVisualBakeWorkerHandler(
			{
				async bake(): Promise<DynamicVisualBakeResult> {
					throw new Error("dynamic bake exploded");
				},
			},
			port,
		);

		port.emitRequest({
			input: createInput(),
			kind: "job",
			requestId: "dynamic-transport:1",
		});
		await port.waitForResponses(1);

		expect(port.responses[0]).toMatchObject({
			kind: "error",
			message: "dynamic bake exploded",
			requestId: "dynamic-transport:1",
		});
	});

	it("posts baked render part buffers as result transfers", async () => {
		const input = createInput();
		const result = createResultWithRenderPart(input);
		const port = new FixtureWorkerPort();
		installDynamicVisualBakeWorkerHandler(
			{
				async bake(): Promise<DynamicVisualBakeResult> {
					return result;
				},
			},
			port,
		);

		port.emitRequest({
			input,
			kind: "job",
			requestId: "dynamic-transport:2",
		});
		await port.waitForResponses(1);

		const part = result.product?.kind === "baked"
			? result.product.resource.renderParts[0]
			: null;
		expect(part).not.toBeNull();
		expect(port.responses[0]).toMatchObject({
			kind: "result",
			requestId: "dynamic-transport:2",
		});
		expect(port.transfers[0]).toEqual([
			part?.positions.buffer,
			part?.texCoords.buffer,
			part?.materialSlotIndices.buffer,
			part?.indices.buffer,
		]);
	});

	it("dispatches dynamic visual bake jobs through the standard central worker queue", async () => {
		const first = new FixtureWorkerPort();
		const second = new FixtureWorkerPort();
		const workers = [first, second];
		const pool = new WorkerPoolDynamicVisualBaker({
			createWorker: () => {
				const worker = workers.shift();
				if (!worker) {
					throw new Error("No fixture dynamic visual bake worker remains.");
				}
				return worker;
			},
			workerCount: 2,
		});
		const firstJob = pool.bake(createInput("dynamic:1"));
		const secondJob = pool.bake(createInput("dynamic:2"));
		const thirdJob = pool.bake(createInput("dynamic:3"));

		expect(first.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-bake:0",
		]);
		expect(second.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-bake:1",
		]);

		first.emit({
			kind: "result",
			output: createResult(createInput("dynamic:1")),
			requestId: "dynamic-visual-bake:0",
		});
		await expect(firstJob).resolves.toMatchObject({ revision: 1 });
		expect(first.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-bake:0",
			"dynamic-visual-bake:2",
		]);

		second.emit({
			kind: "result",
			output: createResult(createInput("dynamic:2")),
			requestId: "dynamic-visual-bake:1",
		});
		first.emit({
			kind: "result",
			output: createResult(createInput("dynamic:3")),
			requestId: "dynamic-visual-bake:2",
		});

		await expect(secondJob).resolves.toMatchObject({ revision: 1 });
		await expect(thirdJob).resolves.toMatchObject({ revision: 1 });
		pool.dispose();
	});
});

class FixtureWorkerPort implements DynamicVisualBakeWorkerPort {
	readonly requests: DynamicVisualBakeWorkerRequest[] = [];
	readonly responses: DynamicVisualBakeWorkerResponse[] = [];
	readonly transfers: readonly Transferable[][] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<DynamicVisualBakeWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message: DynamicVisualBakeWorkerRequest | DynamicVisualBakeWorkerResponse,
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
			| ((event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void)
			| ((event: MessageEvent<DynamicVisualBakeWorkerRequest>) => void),
	): void {
		this.#responseListeners.add(
			listener as (
				event: MessageEvent<DynamicVisualBakeWorkerResponse>,
			) => void,
		);
		this.#requestListeners.add(
			listener as (event: MessageEvent<DynamicVisualBakeWorkerRequest>) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void)
			| ((event: MessageEvent<DynamicVisualBakeWorkerRequest>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (
				event: MessageEvent<DynamicVisualBakeWorkerResponse>,
			) => void,
		);
		this.#requestListeners.delete(
			listener as (event: MessageEvent<DynamicVisualBakeWorkerRequest>) => void,
		);
	}

	emit(response: DynamicVisualBakeWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<DynamicVisualBakeWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: DynamicVisualBakeWorkerRequest): void {
		const event = {
			data: request,
		} as MessageEvent<DynamicVisualBakeWorkerRequest>;
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

function createInput(entityId = "dynamic-visual:test"): DynamicVisualBakeInput {
	return {
		recipe: {
			entityId,
		} as DynamicVisualBakeInput["recipe"],
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

function createResult(input: DynamicVisualBakeInput): DynamicVisualBakeResult {
	return {
		failures: [],
		product: null,
		revision: input.revision,
	};
}

function createResultWithRenderPart(
	input: DynamicVisualBakeInput,
): DynamicVisualBakeResult {
	return {
		failures: [],
		product: {
			kind: "baked",
			resource: {
				entityId: input.recipe.entityId,
				materialSlots: [],
				materialSources: [],
				paletteSources: [],
				renderParts: [createRenderPart()],
				resourceId: `${input.recipe.entityId}:visual-resource`,
				sourceAssets: [],
				textureDependencies: [],
				textureRefs: [],
				textureRequirements: [],
			},
		},
		revision: input.revision,
	};
}

function createRenderPart(): DynamicEntityRenderPart {
	const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	return {
		bounds: null,
		indices: new Uint16Array([0, 1, 2]),
		indexType: "uint16",
		materialEntries: [],
		materialFamily: "flat-color",
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		partIndex: 0,
		positions,
		renderPartId: "dynamic-render-part:0",
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "opaque",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		sourceAssetId: "source-asset:0",
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds: [],
		triangleCount: 1,
		vertexCount: positions.length / 3,
	};
}
