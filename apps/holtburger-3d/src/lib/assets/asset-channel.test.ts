import { describe, expect, it } from "vitest";

import type { AssetLookupRequestDto, AssetLookupResponseDto } from "../host/contracts";
import type { BinaryAssetLookupEnvelopeDto } from "../host/tauri";
import type { AssetWorkerLike } from "./asset-channel";
import { AssetChannelController } from "./asset-channel";
import type {
	AssetWorkerPrepareBatchRequest,
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";
import { prepareAssetPayload } from "../../workers/asset-worker";
import type { PreparedAssetRecord } from "./types";

describe("asset channel", () => {
	it("posts microtask-coalesced worker prepare requests as one batch", async () => {
		const worker = new FakeAssetWorker();
		const channel = new AssetChannelController(
			async () => [],
			() => worker,
		);
		const first = createRequest("request-a", "gfx-obj/01000001");
		const second = createRequest("request-b", "gfx-obj/01000002");

		const firstPrepared = channel.prepareAsset(first);
		const secondPrepared = channel.prepareAsset(second);
		await waitForMicrotasks();

		expect(
			worker.prepareMessages.map((message) =>
				message.items.map((item) => item.request),
			),
		).toEqual([[first, second]]);
		expect(worker.transferLists).toEqual([[]]);

		for (const message of worker.prepareMessages) {
			worker.emitPreparedBatch(message);
		}

		await expect(Promise.all([firstPrepared, secondPrepared])).resolves.toEqual([
			createPreparedAsset(first),
			createPreparedAsset(second),
		]);
	});

	it("bridges worker binary lookup requests and transfers raw envelopes back", async () => {
		const worker = new FakeAssetWorker();
		const envelope = new ArrayBuffer(16);
		const channel = new AssetChannelController(
			async (requests): Promise<BinaryAssetLookupEnvelopeDto[]> => {
				expect(requests.map((request) => request.assetId)).toEqual([
					"landblock/da5fffff/outdoor",
				]);
				return [{ payload: envelope }];
			},
			() => worker,
		);
		const request = createRequest(
			"request-outdoor",
			"landblock/da5fffff/outdoor",
		);

		const prepared = channel.prepareAsset(request);
		await waitForMicrotasks();
		const [prepareMessage] = worker.prepareMessages;
		expect(prepareMessage).toBeDefined();

		worker.emitHostLookupRequest("host-request-a", [request]);
		await waitForMicrotasks();

		expect(worker.messages.at(-1)).toMatchObject({
			type: "host-lookup-assets-binary-complete",
			requestId: "host-request-a",
			envelopes: [{ payload: envelope }],
		});
		expect(worker.transferLists.at(-1)).toEqual([envelope]);

		worker.emitPreparedBatch(prepareMessage as AssetWorkerPrepareBatchRequest);
		await expect(prepared).resolves.toEqual(createPreparedAsset(request));
	});
});

describe("asset worker payload preparation", () => {
	it("fails hard when a landblock outdoor route returns a non-outdoor payload", () => {
		const request = createRequest(
			"request-outdoor",
			"landblock/da5fffff/outdoor",
		);
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "landblock-outdoor",
				residencyKind: "outdoor-landblock",
				sourceAssetKind: "landblock-outdoor",
			},
		};

		expect(() => prepareAssetPayload(request, response)).toThrow(
			/landblock-outdoor route.*payload failed the landblock-outdoor contract/,
		);
	});

	it("fails hard when a gfx object payload omits host-prepared render geometry", () => {
		const request = createRequest("request-gfx", "gfx-obj/01000001");
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "gfx-obj",
				residencyKind: "unknown",
				sourceAssetKind: "gfx-obj",
				gfxObjId: 0x01000001,
				flags: null,
				surfaceIds: [],
				vertexArray: {
					vertexType: 0,
					vertexCount: 0,
					vertices: [],
				},
				drawingPolygons: [],
				drawingBsp: null,
				dependencies: { materialAssetIds: [] },
				physicsWitness: {
					polygonCount: 0,
					hasBsp: false,
				},
				sortCenter: null,
				didDegrade: null,
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "gfx-obj",
					errorCode: null,
					detail: null,
				},
			},
		};

		expect(() => prepareAssetPayload(request, response)).toThrow(
			/gfx-obj route.*payload failed the gfx-obj contract.*renderGeometry/,
		);
	});
});

class FakeAssetWorker implements AssetWorkerLike {
	onmessage: ((event: MessageEvent<AssetWorkerResponseMessage>) => void) | null =
		null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;
	readonly messages: AssetWorkerRequestMessage[] = [];
	readonly transferLists: Transferable[][] = [];

	get prepareMessages(): AssetWorkerPrepareBatchRequest[] {
		return this.messages.filter(
			(message): message is AssetWorkerPrepareBatchRequest =>
				message.type === "prepare-assets",
		);
	}

	postMessage(
		message: AssetWorkerRequestMessage,
		transferables: Transferable[] = [],
	): void {
		this.messages.push(message);
		this.transferLists.push(transferables);
	}

	terminate(): void {}

	emitHostLookupRequest(
		requestId: string,
		requests: AssetLookupRequestDto[],
	): void {
		this.onmessage?.({
			data: {
				type: "host-lookup-assets-binary",
				requestId,
				requests,
			},
		} as MessageEvent<AssetWorkerResponseMessage>);
	}

	emitPreparedBatch(message: AssetWorkerPrepareBatchRequest): void {
		this.onmessage?.({
			data: {
				type: "assets-prepared",
				results: message.items.map((item) => ({
					type: "asset-ready",
					asset: createPreparedAsset(item.request),
				})),
			},
		} as MessageEvent<AssetWorkerResponseMessage>);
	}
}

function createRequest(
	requestId: string,
	assetId: string,
): AssetLookupRequestDto {
	return {
		requestId,
		assetId,
		priority: "streaming",
	};
}

function createPreparedAsset(request: AssetLookupRequestDto): PreparedAssetRecord {
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: { kind: "prepared-response-summary" },
		},
		payload: {
			kind: "unknown",
			sourceAssetKind: null,
			residencyKind: "unknown",
			provenance: {
				source: "unknown",
				sourceAssetKind: null,
				errorCode: null,
				detail: null,
			},
			rawKind: "synthetic",
			debugPresentation: null,
		},
		preparedAt: "2026-05-22T00:00:00.000Z",
	};
}

async function waitForMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
