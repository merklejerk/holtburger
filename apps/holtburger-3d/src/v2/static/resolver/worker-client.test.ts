import { describe, expect, it } from "vitest";
import type { StaticScopePayload, StaticWorkRequest } from "../contracts";
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
		const request = createRequest();
		const pending = client.resolve(request);

		expect(port.requests).toEqual([
			{
				kind: "resolve-static-scope",
				request,
				requestId: request.requestId,
			},
		]);

		port.emit({
			kind: "static-scope-resolved",
			payload: createPayload(request),
			requestId: request.requestId,
		});

		await expect(pending).resolves.toMatchObject({
			request,
			scope: { kind: "placeholder" },
		});
		client.dispose();
	});

	it("turns resolver handler failures into typed worker responses", async () => {
		const request = createRequest();
		const responses: StaticResolverWorkerResponse[] = [];

		await handleStaticResolverWorkerRequest(
			{
				async resolve(): Promise<StaticScopePayload> {
					throw new Error("missing terrain root");
				},
			},
			{
				kind: "resolve-static-scope",
				request,
				requestId: request.requestId,
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "static-scope-resolve-failed",
				message: "missing terrain root",
				requestId: request.requestId,
			},
		]);
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
		const event = { data: response } as MessageEvent<StaticResolverWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function createRequest(): StaticWorkRequest {
	return {
		domain: "terrain",
		policyRevision: 1,
		priority: 0,
		requestId: "1:landblock:da55ffff:terrain",
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createPayload(request: StaticWorkRequest): StaticScopePayload {
	return {
		request,
		scope: {
			kind: "placeholder",
			referencedTextureUses: [],
		},
		sourceRevision: request.revision,
	};
}
