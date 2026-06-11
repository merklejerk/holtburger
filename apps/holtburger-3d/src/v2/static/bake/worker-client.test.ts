import { describe, expect, it } from "vitest";
import type { StaticBakeInput, StaticBakeResult } from "../contracts";
import {
	StaticBakeWorkerClient,
} from "./worker-client";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerRequest,
	StaticBakeWorkerResponse,
} from "./protocol";
import { handleStaticBakeWorkerRequest } from "./worker-handler";

describe("V2 static bake worker protocol", () => {
	it("posts static bake inputs and resolves returned bake results", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticBakeWorkerClient(port);
		const input = createInput();
		const pending = client.bake(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "bake-static-scope",
				requestId: "bake-job:0",
			},
		]);

		port.emit({
			kind: "static-scope-baked",
			requestId: "bake-job:0",
			result: createResult(input),
		});

		await expect(pending).resolves.toMatchObject({
			drawUnits: [{ kind: "placeholder" }],
			work: input.work,
		});
		client.dispose();
	});

	it("turns baker handler failures into typed worker responses", async () => {
		const input = createInput();
		const responses: StaticBakeWorkerResponse[] = [];

		await handleStaticBakeWorkerRequest(
			{
				async bake(): Promise<StaticBakeResult> {
					throw new Error("unsupported bake payload");
				},
			},
			{
				input,
				kind: "bake-static-scope",
				requestId: "transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "static-scope-bake-failed",
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

function createInput(): StaticBakeInput {
	const work = {
		job: {
			domain: "outdoor-terrain" as const,
			scope: {
				kind: "landblock" as const,
				landblockId: 0xda55ffff,
			},
		},
		priority: 0,
		revision: 1,
		workId: "1:landblock:da55ffff:outdoor-terrain",
	};

	return {
		atlasSnapshot: {
			domain: "outdoor-terrain",
			placements: [],
			staticBatchId: "batch-a",
			textureUses: [],
		},
		payload: {
			job: work.job,
			scope: {
				kind: "placeholder",
				referencedTextureUses: [],
			},
			sourceRevision: 1,
		},
		staticBatchId: "batch-a",
		work,
	};
}

function createResult(input: StaticBakeInput): StaticBakeResult {
	return {
		atlasRegistryUpdates: [],
		buildRevision: 1,
		drawUnits: [
			{
				drawUnitId: "placeholder",
				kind: "placeholder",
			},
		],
		staticAuthoredDynamicSeeds: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		staticBatchId: input.staticBatchId,
		textureUses: [],
		work: input.work,
	};
}
