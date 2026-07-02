import { describe, expect, it } from "vitest";
import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
	StaticBakeTask,
} from "../contracts";
import { StaticBakeWorkerClient, WorkerPoolStaticBaker } from "./worker-client";
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
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				bakeBatchId: input.bakeBatchId,
				requestId: "bake-job:0",
				stage: "queued",
			},
		]);

		port.emit({
			kind: "static-batch-bake-started",
			requestId: "bake-job:0",
		});
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				bakeBatchId: input.bakeBatchId,
				requestId: "bake-job:0",
				stage: "executing",
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
				kind: "static-batch-bake-started",
				requestId: "transport:1",
			},
			{
				kind: "static-batch-bake-failed",
				message: "unsupported bake payload",
				requestId: "transport:1",
			},
		]);
	});

	it("assigns new bake jobs to idle workers before queueing behind busy workers", async () => {
		const first = new ControlledStaticBaker();
		const second = new ControlledStaticBaker();
		const pool = new WorkerPoolStaticBaker([first, second]);
		const firstJob = pool.bake(createInput("batch-1"));
		const secondJob = pool.bake(createInput("batch-2"));

		expect(first.inputs.map((input) => input.bakeBatchId)).toEqual(["batch-1"]);
		expect(second.inputs.map((input) => input.bakeBatchId)).toEqual([
			"batch-2",
		]);

		first.resolveNext();
		await firstJob;
		const thirdJob = pool.bake(createInput("batch-3"));
		expect(first.inputs.map((input) => input.bakeBatchId)).toEqual([
			"batch-1",
			"batch-3",
		]);

		first.resolveNext();
		await thirdJob;
		const fourthJob = pool.bake(createInput("batch-4"));
		expect(first.inputs.map((input) => input.bakeBatchId)).toEqual([
			"batch-1",
			"batch-3",
			"batch-4",
		]);
		expect(second.inputs.map((input) => input.bakeBatchId)).toEqual([
			"batch-2",
		]);

		first.resolveNext();
		second.resolveNext();
		await Promise.all([secondJob, fourthJob]);
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

class ControlledStaticBaker implements StaticBaker {
	readonly inputs: StaticBakeBatchInput[] = [];
	readonly #pending: Array<{
		readonly input: StaticBakeBatchInput;
		readonly resolve: (result: StaticBakeBatchResult) => void;
	}> = [];

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		this.inputs.push(input);
		return new Promise((resolve) => {
			this.#pending.push({ input, resolve });
		});
	}

	resolveNext(): void {
		const pending = this.#pending.shift();
		if (!pending) {
			throw new Error("No pending static bake job exists.");
		}
		pending.resolve(createResult(pending.input));
	}
}

function createInput(bakeBatchId = "batch-a"): StaticBakeBatchInput {
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
		bakeBatchId,
	};
}

function createResult(input: StaticBakeBatchInput): StaticBakeBatchResult {
	return {
		atlasRegistryUpdates: [],
		buildRevision: 1,
		domain: input.domain,
		drawUnits: [],
		materialCoverage: [],
		portalApertureResources: [],
		revision: input.revision,
		envCellStaticObjectPlacementRecords: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		bakeBatchId: input.bakeBatchId,
		tasks: input.items.map((item) => item.task),
		textureDependencies: [],
		textureUses: [],
	};
}
