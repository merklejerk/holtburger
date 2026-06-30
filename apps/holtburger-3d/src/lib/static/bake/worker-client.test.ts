import { describe, expect, it } from "vitest";
import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBakeTask,
} from "../contracts";
import { StaticBakeWorkerClient } from "./worker-client";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerRequest,
	StaticBakeWorkerResponse,
} from "./protocol";
import { handleStaticBakeWorkerRequest } from "./worker-handler";

describe("static bake worker protocol", () => {
	it("posts static bake inputs and resolves returned bake results", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticBakeWorkerClient(port);
		const input = createInput();
		const pending = client.bake(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "bake-static-batch",
				requestId: "bake-job:0",
			},
		]);

		port.emit({
			kind: "static-batch-baked",
			requestId: "bake-job:0",
			result: createResult(input),
		});

		await expect(pending).resolves.toMatchObject({
			drawUnits: [],
			tasks: [input.items[0]?.task],
		});
		client.dispose();
	});

	it("turns baker handler failures into typed worker responses", async () => {
		const input = createInput();
		const responses: StaticBakeWorkerResponse[] = [];

		await handleStaticBakeWorkerRequest(
			{
				async bake(): Promise<StaticBakeBatchResult> {
					throw new Error("unsupported bake payload");
				},
			},
			{
				input,
				kind: "bake-static-batch",
				requestId: "transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "static-batch-bake-failed",
				message: "unsupported bake payload",
				requestId: "transport:1",
			},
		]);
	});
});

class FixtureWorkerPort implements StaticBakeWorkerPort {
	readonly requests: StaticBakeWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<StaticBakeWorkerResponse>) => void
	>();

	postMessage(message: StaticBakeWorkerRequest): void {
		this.requests.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: StaticBakeWorkerResponse): void {
		const event = { data: response } as MessageEvent<StaticBakeWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function createInput(): StaticBakeBatchInput {
	const task: StaticBakeTask = {
		domain: "outdoor-terrain",
		ownerId: "terrain:0xda55ffff",
		ownerKey: {
			kind: "terrain",
			landblockId: 0xda55ffff,
		},
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "1:landblock:da55ffff:outdoor-terrain",
	};

	return {
		atlasSnapshot: {
			domain: "outdoor-terrain",
			placements: [],
			staticBatchId: "batch-a",
			textureUses: [],
		},
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		domain: "outdoor-terrain",
		items: [
			{
				payload: {
					job: {
						domain: task.domain,
						scope: task.scope,
					},
					scope: {
						kind: "placeholder",
						referencedTextureUses: [],
					},
					sourceRevision: 1,
				},
				task,
			},
		],
		revision: 1,
		staticBatchId: "batch-a",
	};
}

function createResult(input: StaticBakeBatchInput): StaticBakeBatchResult {
	return {
		atlasRegistryUpdates: [],
		buildRevision: 1,
		domain: input.domain,
		drawUnits: [],
		staticObjectRenderInstances: [],
		staticObjectVisualResources: [],
		materialCoverage: [],
		portalApertureResources: [],
		revision: input.revision,
		envCellStaticObjectPlacementRecords: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		staticBatchId: input.staticBatchId,
		tasks: input.items.map((item) => item.task),
		textureUses: [],
	};
}
