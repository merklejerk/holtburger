import { describe, expect, it } from "vitest";
import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";
import type {
	DynamicVisualBakeWorkerPort,
	DynamicVisualBakeWorkerRequest,
	DynamicVisualBakeWorkerResponse,
} from "./visual-bake-protocol";
import {
	DynamicVisualBakeWorkerClient,
	WorkerPoolDynamicVisualBaker,
} from "./visual-bake-worker-client";
import { handleDynamicVisualBakeWorkerRequest } from "./visual-bake-worker-handler";

describe("dynamic visual bake worker protocol", () => {
	it("posts dynamic visual bake inputs and resolves returned bake results", async () => {
		const port = new FixtureWorkerPort();
		const client = new DynamicVisualBakeWorkerClient(port);
		const input = createInput();
		const pending = client.bake(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "bake-dynamic-visual",
				requestId: "dynamic-visual-bake:0",
			},
		]);

		port.emit({
			kind: "dynamic-visual-baked",
			requestId: "dynamic-visual-bake:0",
			result: createResult(input),
		});

		await expect(pending).resolves.toMatchObject({
			product: null,
			revision: input.revision,
		});
		client.dispose();
	});

	it("turns baker handler failures into typed worker responses", async () => {
		const input = createInput();
		const responses: DynamicVisualBakeWorkerResponse[] = [];

		await handleDynamicVisualBakeWorkerRequest(
			{
				async bake(): Promise<DynamicVisualBakeResult> {
					throw new Error("dynamic bake exploded");
				},
			},
			{
				input,
				kind: "bake-dynamic-visual",
				requestId: "dynamic-transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "dynamic-visual-bake-failed",
				message: "dynamic bake exploded",
				requestId: "dynamic-transport:1",
			},
		]);
	});

	it("round-robins dynamic visual bake jobs across the worker pool", async () => {
		const first = new RecordingBaker("first");
		const second = new RecordingBaker("second");
		const pool = new WorkerPoolDynamicVisualBaker([first, second]);

		await pool.bake(createInput("dynamic:1"));
		await pool.bake(createInput("dynamic:2"));
		await pool.bake(createInput("dynamic:3"));

		expect(first.entityIds).toEqual(["dynamic:1", "dynamic:3"]);
		expect(second.entityIds).toEqual(["dynamic:2"]);
	});
});

class FixtureWorkerPort implements DynamicVisualBakeWorkerPort {
	readonly requests: DynamicVisualBakeWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void
	>();

	postMessage(message: DynamicVisualBakeWorkerRequest): void {
		this.requests.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<DynamicVisualBakeWorkerResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: DynamicVisualBakeWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<DynamicVisualBakeWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

class RecordingBaker {
	readonly entityIds: string[] = [];

	constructor(private readonly label: string) {}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		this.entityIds.push(input.recipe.entityId);
		return Promise.resolve({
			failures: [],
			product: null,
			revision: input.revision,
		});
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
