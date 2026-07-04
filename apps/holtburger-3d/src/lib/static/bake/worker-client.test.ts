import { describe, expect, it } from "vitest";
import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBakeTask,
} from "../contracts";
import { StaticBakeWorkerClient, WorkerPoolStaticBaker } from "./worker-client";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerRequest,
	StaticBakeWorkerResponse,
} from "./protocol";
import { installStaticBakeWorkerHandler } from "./worker-handler";
import { emitStaticBakeWorkerTrace } from "./worker-trace";

describe("static bake worker protocol", () => {
	it("posts standard static bake inputs and resolves returned bake results", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticBakeWorkerClient(port);
		const input = createInput();
		const pending = client.bake(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "job",
				requestId: "bake-job:0",
			},
		]);
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				requestId: "bake-job:0",
				stage: "executing",
				taskId: input.task.taskId,
			},
		]);

		port.emit({
			event: { kind: "started" },
			kind: "progress",
			requestId: "bake-job:0",
		});
		port.emit({
			event: {
				event: { atMs: 12, details: { drawUnits: 1 }, stage: "fixture" },
				kind: "trace",
			},
			kind: "progress",
			requestId: "bake-job:0",
		});
		expect(client.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{
				requestId: "bake-job:0",
				stage: "executing",
				taskId: input.task.taskId,
				traceEvents: [
					{
						details: { drawUnits: 1 },
						stage: "fixture",
					},
				],
			},
		]);

		port.emit({
			kind: "result",
			output: createResult(input),
			requestId: "bake-job:0",
		});

		await expect(pending).resolves.toMatchObject({
			drawUnits: [],
			task: input.task,
		});
		client.dispose();
	});

	it("turns baker handler failures into standard worker errors after started progress", async () => {
		const port = new FixtureWorkerPort();
		installStaticBakeWorkerHandler(
			{
				async bake(): Promise<StaticBakeJobResult> {
					throw new Error("unsupported bake payload");
				},
			},
			port,
		);

		port.emitRequest({
			input: createInput(),
			kind: "job",
			requestId: "transport:1",
		});
		await port.waitForResponses(2);

		expect(port.responses[0]).toEqual({
			event: { kind: "started" },
			kind: "progress",
			requestId: "transport:1",
		});
		expect(port.responses[1]).toMatchObject({
			kind: "error",
			message: "unsupported bake payload",
			requestId: "transport:1",
		});
	});

	it("preserves static bake trace events through standard progress", async () => {
		const input = createInput();
		const port = new FixtureWorkerPort();
		installStaticBakeWorkerHandler(
			{
				async bake(): Promise<StaticBakeJobResult> {
					emitStaticBakeWorkerTrace("fixture-stage", { textures: 2 });
					return createResult(input);
				},
			},
			port,
		);

		port.emitRequest({
			input,
			kind: "job",
			requestId: "transport:2",
		});
		await port.waitForResponses(3);

		expect(port.responses).toMatchObject([
			{
				event: { kind: "started" },
				kind: "progress",
				requestId: "transport:2",
			},
			{
				event: {
					event: {
						details: { textures: 2 },
						stage: "fixture-stage",
					},
					kind: "trace",
				},
				kind: "progress",
				requestId: "transport:2",
			},
			{
				kind: "result",
				requestId: "transport:2",
			},
		]);
	});

	it("assigns new bake jobs to idle workers before queueing behind busy workers", async () => {
		const first = new FixtureWorkerPort();
		const second = new FixtureWorkerPort();
		const workers = [first, second];
		const pool = new WorkerPoolStaticBaker({
			createWorker: () => {
				const worker = workers.shift();
				if (!worker) {
					throw new Error("No fixture static bake worker remains.");
				}
				return worker;
			},
			workerCount: 2,
		});
		const firstJob = pool.bake(createInput("task-1"));
		const secondJob = pool.bake(createInput("task-2"));
		const thirdJob = pool.bake(createInput("task-3"));

		expect(first.requests.map((request) => request.requestId)).toEqual([
			"bake-job:0",
		]);
		expect(second.requests.map((request) => request.requestId)).toEqual([
			"bake-job:1",
		]);
		expect(pool.createDiagnosticsSnapshot().pendingJobs).toMatchObject([
			{ requestId: "bake-job:2", stage: "queued", taskId: "task-3" },
			{ requestId: "bake-job:0", stage: "executing", taskId: "task-1" },
			{ requestId: "bake-job:1", stage: "executing", taskId: "task-2" },
		]);

		first.emit({
			kind: "result",
			output: createResult(createInput("task-1")),
			requestId: "bake-job:0",
		});
		await expect(firstJob).resolves.toMatchObject({
			task: { taskId: "task-1" },
		});
		expect(first.requests.map((request) => request.requestId)).toEqual([
			"bake-job:0",
			"bake-job:2",
		]);

		second.emit({
			kind: "result",
			output: createResult(createInput("task-2")),
			requestId: "bake-job:1",
		});
		first.emit({
			kind: "result",
			output: createResult(createInput("task-3")),
			requestId: "bake-job:2",
		});

		await expect(secondJob).resolves.toMatchObject({
			task: { taskId: "task-2" },
		});
		await expect(thirdJob).resolves.toMatchObject({
			task: { taskId: "task-3" },
		});
		pool.dispose();
	});
});

class FixtureWorkerPort implements StaticBakeWorkerPort {
	readonly requests: StaticBakeWorkerRequest[] = [];
	readonly responses: StaticBakeWorkerResponse[] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<StaticBakeWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<StaticBakeWorkerResponse>) => void
	>();
	#waiters: Array<() => void> = [];

	postMessage(
		message: StaticBakeWorkerRequest | StaticBakeWorkerResponse,
	): void {
		if (message.kind === "job" || message.kind === "cancel") {
			this.requests.push(message);
			return;
		}
		this.responses.push(message);
		this.#flushWaiters();
	}

	addEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<StaticBakeWorkerResponse>) => void)
			| ((event: MessageEvent<StaticBakeWorkerRequest>) => void),
	): void {
		this.#responseListeners.add(
			listener as (event: MessageEvent<StaticBakeWorkerResponse>) => void,
		);
		this.#requestListeners.add(
			listener as (event: MessageEvent<StaticBakeWorkerRequest>) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((event: MessageEvent<StaticBakeWorkerResponse>) => void)
			| ((event: MessageEvent<StaticBakeWorkerRequest>) => void),
	): void {
		this.#responseListeners.delete(
			listener as (event: MessageEvent<StaticBakeWorkerResponse>) => void,
		);
		this.#requestListeners.delete(
			listener as (event: MessageEvent<StaticBakeWorkerRequest>) => void,
		);
	}

	emit(response: StaticBakeWorkerResponse): void {
		const event = { data: response } as MessageEvent<StaticBakeWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}

	emitRequest(request: StaticBakeWorkerRequest): void {
		const event = { data: request } as MessageEvent<StaticBakeWorkerRequest>;
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

function createInput(
	taskId = "1:landblock:da55ffff:outdoor-terrain",
): StaticBakeJobInput {
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
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		revision: 1,
		task,
	};
}

function createResult(input: StaticBakeJobInput): StaticBakeJobResult {
	return {
		atlasRegistryUpdates: [],
		buildRevision: 1,
		domain: input.domain,
		drawUnits: [],
		envCellStaticObjectPlacementRecords: [],
		materialCoverage: [],
		portalApertureResources: [],
		revision: input.revision,
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
