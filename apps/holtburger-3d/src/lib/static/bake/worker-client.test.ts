import { describe, expect, it } from "vitest";
import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
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
				kind: "bake-static-job",
				requestId: "bake-job:0",
			},
		]);
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				taskId: input.task.taskId,
				requestId: "bake-job:0",
				stage: "queued",
			},
		]);

		port.emit({
			kind: "static-job-bake-started",
			requestId: "bake-job:0",
		});
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				taskId: input.task.taskId,
				requestId: "bake-job:0",
				stage: "executing",
			},
		]);
		port.emit({
			kind: "static-job-baked",
			requestId: "bake-job:0",
			result: createResult(input),
		});

		await expect(pending).resolves.toMatchObject({
			drawUnits: [],
			task: input.task,
		});
		client.dispose();
	});

	it("turns baker handler failures into typed worker responses", async () => {
		const input = createInput();
		const responses: StaticBakeWorkerResponse[] = [];

		await handleStaticBakeWorkerRequest(
			{
				async bake(): Promise<StaticBakeJobResult> {
					throw new Error("unsupported bake payload");
				},
			},
			{
				input,
				kind: "bake-static-job",
				requestId: "transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "static-job-bake-started",
				requestId: "transport:1",
			},
			{
				kind: "static-job-bake-failed",
				message: "unsupported bake payload",
				requestId: "transport:1",
			},
		]);
	});

	it("assigns new bake jobs to idle workers before queueing behind busy workers", async () => {
		const first = new ControlledStaticBaker();
		const second = new ControlledStaticBaker();
		const pool = new WorkerPoolStaticBaker([first, second]);
		const firstJob = pool.bake(createInput("task-1"));
		const secondJob = pool.bake(createInput("task-2"));

		expect(first.inputs.map((input) => input.task.taskId)).toEqual(["task-1"]);
		expect(second.inputs.map((input) => input.task.taskId)).toEqual(["task-2"]);

		first.resolveNext();
		await firstJob;
		const thirdJob = pool.bake(createInput("task-3"));
		expect(first.inputs.map((input) => input.task.taskId)).toEqual([
			"task-1",
			"task-3",
		]);

		first.resolveNext();
		await thirdJob;
		const fourthJob = pool.bake(createInput("task-4"));
		expect(first.inputs.map((input) => input.task.taskId)).toEqual([
			"task-1",
			"task-3",
			"task-4",
		]);
		expect(second.inputs.map((input) => input.task.taskId)).toEqual(["task-2"]);

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
	readonly inputs: StaticBakeJobInput[] = [];
	readonly #pending: Array<{
		readonly input: StaticBakeJobInput;
		readonly resolve: (result: StaticBakeJobResult) => void;
	}> = [];

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
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

function createInput(taskId = "1:landblock:da55ffff:outdoor-terrain"): StaticBakeJobInput {
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
		taskId,
	};

	return {
		domain: "outdoor-terrain",
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
		revision: 1,
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		task,
	};
}

function createResult(input: StaticBakeJobInput): StaticBakeJobResult {
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
		task: input.task,
		textureDependencies: [],
		textureUses: [],
	};
}
