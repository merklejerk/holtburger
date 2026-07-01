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
				kind: "bake-dynamic-visual-batch",
				requestId: "dynamic-visual-bake:0",
			},
		]);

		port.emit({
			kind: "dynamic-visual-batch-baked",
			requestId: "dynamic-visual-bake:0",
			result: createResult(input),
		});

		await expect(pending).resolves.toMatchObject({
			batchId: input.batchId,
			products: [],
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
				kind: "bake-dynamic-visual-batch",
				requestId: "dynamic-transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "dynamic-visual-batch-bake-failed",
				message: "dynamic bake exploded",
				requestId: "dynamic-transport:1",
			},
		]);
	});

	it("round-robins dynamic visual bake jobs across the worker pool", async () => {
		const first = new RecordingBaker("first");
		const second = new RecordingBaker("second");
		const pool = new WorkerPoolDynamicVisualBaker([first, second]);

		await pool.bake(createInput("batch:1"));
		await pool.bake(createInput("batch:2"));
		await pool.bake(createInput("batch:3"));

		expect(first.batchIds).toEqual(["batch:1", "batch:3"]);
		expect(second.batchIds).toEqual(["batch:2"]);
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
	readonly batchIds: string[] = [];

	constructor(private readonly label: string) {}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		this.batchIds.push(input.batchId);
		return Promise.resolve({
			batchId: `${this.label}:${input.batchId}`,
			failures: [],
			products: [],
			revision: input.revision,
		});
	}
}

function createInput(
	batchId = "dynamic-visual-batch:test",
): DynamicVisualBakeInput {
	return {
		batchId,
		recipes: [],
		revision: 1,
		sourceGeometry: [],
		texturePlacementSnapshot: {
			itemIdsByTextureUseId: new Map(),
			placementsByItemId: new Map(),
		},
		texturePlannings: [],
	};
}

function createResult(input: DynamicVisualBakeInput): DynamicVisualBakeResult {
	return {
		batchId: input.batchId,
		failures: [],
		products: [],
		revision: input.revision,
	};
}
