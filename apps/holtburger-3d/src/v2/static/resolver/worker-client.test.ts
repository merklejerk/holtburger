import { describe, expect, it } from "vitest";
import type { StaticResolverJob, StaticScopePayload } from "../contracts";
import type {
	StaticResolverWorkerPort,
	StaticResolverWorkerRequest,
	StaticResolverWorkerResponse,
} from "./protocol";
import { StaticResolverWorkerClient } from "./worker-client";
import { handleStaticResolverWorkerRequest } from "./worker-handler";

describe("V2 static resolver worker protocol", () => {
	it("posts concrete static work requests and resolves returned payloads", async () => {
		const port = new FixtureWorkerPort();
		const client = new StaticResolverWorkerClient(port);
		const job = createJob();
		const pending = client.resolve(job);

		expect(port.requests).toEqual([
			{
				job,
				kind: "resolve-static-scope",
				requestId: "resolver-job:0",
			},
		]);

		port.emit({
			kind: "static-scope-resolved",
			payload: createPayload(job),
			requestId: "resolver-job:0",
		});

		await expect(pending).resolves.toMatchObject({
			job,
			scope: { kind: "placeholder" },
		});
		client.dispose();
	});

	it("turns resolver handler failures into typed worker responses", async () => {
		const job = createJob();
		const responses: StaticResolverWorkerResponse[] = [];

		await handleStaticResolverWorkerRequest(
			() => ({
				async resolve(): Promise<StaticScopePayload> {
					throw new Error("missing terrain root");
				},
			}),
			{
				job,
				kind: "resolve-static-scope",
				requestId: "transport:1",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "static-scope-resolve-failed",
				message: "missing terrain root",
				requestId: "transport:1",
			},
		]);
	});

	it("constructs a fresh resolver for each static scope request", async () => {
		const job = createJob();
		const responses: StaticResolverWorkerResponse[] = [];
		let resolverCount = 0;

		await handleStaticResolverWorkerRequest(
			() => {
				resolverCount += 1;
				return {
					async resolve(): Promise<StaticScopePayload> {
						return createPayload(job);
					},
				};
			},
			{
				job,
				kind: "resolve-static-scope",
				requestId: "transport:1",
			},
			(response) => responses.push(response),
		);
		await handleStaticResolverWorkerRequest(
			() => {
				resolverCount += 1;
				return {
					async resolve(): Promise<StaticScopePayload> {
						return createPayload(job);
					},
				};
			},
			{
				job,
				kind: "resolve-static-scope",
				requestId: "transport:2",
			},
			(response) => responses.push(response),
		);

		expect(resolverCount).toBe(2);
		expect(responses).toHaveLength(2);
	});
});

class FixtureWorkerPort implements StaticResolverWorkerPort {
	readonly requests: StaticResolverWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<StaticResolverWorkerResponse>) => void
	>();

	postMessage(message: StaticResolverWorkerRequest): void {
		this.requests.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: StaticResolverWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<StaticResolverWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function createJob(): StaticResolverJob {
	return {
		domain: "outdoor-terrain",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createPayload(job: StaticResolverJob): StaticScopePayload {
	return {
		job,
		scope: {
			kind: "placeholder",
			referencedTextureUses: [],
		},
		sourceRevision: 1,
	};
}
