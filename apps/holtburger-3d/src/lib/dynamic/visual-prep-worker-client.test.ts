import { describe, expect, it } from "vitest";
import type { HostAssetKey, PreparedAssetReader } from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import type {
	DynamicVisualBakeResult,
	DynamicVisualPrepInput,
} from "./contracts";
import type {
	DynamicVisualPrepWorkerPort,
	DynamicVisualPrepWorkerRequest,
	DynamicVisualPrepWorkerResponse,
} from "./visual-prep-protocol";
import { WorkerPoolDynamicVisualPrepper } from "./visual-prep-worker-client";

describe("dynamic visual prep worker protocol", () => {
	it("dispatches prep jobs through the standard central worker queue", async () => {
		const first = new FixtureWorkerPort();
		const second = new FixtureWorkerPort();
		const workers = [first, second];
		const pool = new WorkerPoolDynamicVisualPrepper({
			assetReader: new FixturePreparedAssetReader(),
			createWorker: () => {
				const worker = workers.shift();
				if (!worker) {
					throw new Error("No fixture dynamic visual prep worker remains.");
				}
				return worker;
			},
			workerCount: 2,
		});
		const firstJob = pool.prepare(createInput("dynamic:1"));
		const secondJob = pool.prepare(createInput("dynamic:2"));
		const thirdJob = pool.prepare(createInput("dynamic:3"));

		expect(first.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-prep:0",
		]);
		expect(second.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-prep:1",
		]);

		first.emit({
			kind: "result",
			output: createResult(createInput("dynamic:1")),
			requestId: "dynamic-visual-prep:0",
		});
		await expect(firstJob).resolves.toMatchObject({ revision: 1 });
		expect(first.requests.map((request) => request.requestId)).toEqual([
			"dynamic-visual-prep:0",
			"dynamic-visual-prep:2",
		]);

		second.emit({
			kind: "result",
			output: createResult(createInput("dynamic:2")),
			requestId: "dynamic-visual-prep:1",
		});
		first.emit({
			kind: "result",
			output: createResult(createInput("dynamic:3")),
			requestId: "dynamic-visual-prep:2",
		});

		await expect(secondJob).resolves.toMatchObject({ revision: 1 });
		await expect(thirdJob).resolves.toMatchObject({ revision: 1 });
		pool.dispose();
	});

	it("serves prepared asset requests from the host-side reader", async () => {
		const worker = new FixtureWorkerPort();
		const assetKey = createHostAssetKey("gfx-obj", 0x02000123);
		const assetReader = new FixturePreparedAssetReader(assetKey);
		const pool = new WorkerPoolDynamicVisualPrepper({
			assetReader,
			createWorker: () => worker,
			workerCount: 1,
		});
		const pending = pool.prepare(createInput("dynamic:asset-service"));

		worker.emit({
			kind: "service-request",
			request: {
				key: assetKey,
				kind: "prepared-asset",
			},
			requestId: "dynamic-visual-prep:0",
			serviceRequestId: "service:1",
		});
		await worker.waitForRequests(2);

		expect(assetReader.requests).toEqual([assetKey]);
		const serviceResponse = worker.requests.at(-1);
		expect(serviceResponse).toMatchObject({
			kind: "service-response",
			serviceRequestId: "service:1",
		});
		if (serviceResponse?.kind !== "service-response") {
			throw new Error("Expected worker to receive a prepared asset service response.");
		}
		expect(serviceResponse.response).toMatchObject({
			asset: {
				payload: {
					renderGeometry: {
						positions: expect.any(Float32Array),
					},
				},
			},
			kind: "prepared-asset",
		});

		worker.emit({
			kind: "result",
			output: createResult(createInput("dynamic:asset-service")),
			requestId: "dynamic-visual-prep:0",
		});
		await expect(pending).resolves.toMatchObject({ revision: 1 });
		pool.dispose();
	});
});

class FixtureWorkerPort implements DynamicVisualPrepWorkerPort {
	readonly requests: DynamicVisualPrepWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<DynamicVisualPrepWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(message: DynamicVisualPrepWorkerRequest): void {
		this.requests.push(message);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<DynamicVisualPrepWorkerResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<DynamicVisualPrepWorkerResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: DynamicVisualPrepWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<DynamicVisualPrepWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}

	waitForRequests(count: number): Promise<void> {
		if (this.requests.length >= count) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#waiters.push(() => {
				if (this.requests.length >= count) {
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
	readonly #assetKey: HostAssetKey;

	constructor(assetKey = createHostAssetKey("gfx-obj", 0x02000001)) {
		this.#assetKey = assetKey;
	}

	requestPreparedAsset(key: HostAssetKey) {
		this.requests.push(key);
		return Promise.resolve({
			key,
			payload: {
				kind: "gfx-obj",
				renderGeometry: {
					positions: new Float32Array([1, 2, 3]),
				},
			},
			preparedAt: "2026-07-07T00:00:00.000Z",
			revision: 1,
			sourceAssetId: this.#assetKey.id,
		});
	}
}

function createInput(entityId = "dynamic-visual:test"): DynamicVisualPrepInput {
	return {
		recipe: {
			entityId,
		} as DynamicVisualPrepInput["recipe"],
		revision: 1,
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

function createResult(input: DynamicVisualPrepInput): DynamicVisualBakeResult {
	return {
		failures: [],
		product: null,
		revision: input.revision,
	};
}
