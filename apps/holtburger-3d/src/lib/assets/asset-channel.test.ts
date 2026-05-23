import { describe, expect, it } from "vitest";

import type { AssetLookupRequestDto } from "../host/contracts";
import type { BinaryAssetLookupEnvelopeDto } from "../host/tauri";
import type { AssetWorkerLike } from "./asset-channel";
import { AssetChannelController } from "./asset-channel";
import type {
	AssetWorkerPrepareBatchRequest,
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
	QueuedPrepareItem,
} from "../../workers/asset-worker";
import { planWorkerPrepareBatches } from "../../workers/asset-worker";
import type { PreparedAssetRecord } from "./types";

describe("asset channel", () => {
	it("posts one worker prepare request per asset", async () => {
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
		).toEqual([[first], [second]]);
		expect(worker.transferLists).toEqual([[], []]);

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
					"landblock-pack/da5fffff",
				]);
				return [{ payload: envelope }];
			},
			() => worker,
		);
		const request = createRequest("request-pack", "landblock-pack/da5fffff");

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

describe("asset worker prepare batching", () => {
	it("batches small assets while isolating landblock packs", () => {
		const items = [
			createQueuedItem("request-a", "gfx-obj/01000001"),
			createQueuedItem("request-b", "gfx-obj/01000002"),
			createQueuedItem("request-pack", "landblock-pack/da5fffff"),
			createQueuedItem("request-c", "landblock-summary/da5fffff"),
			createQueuedItem("request-d", "gfx-obj/01000003"),
			createQueuedItem("request-e", "gfx-obj/01000004"),
		];

		expect(
			planWorkerPrepareBatches(items, 2).map((batch) =>
				batch.map((item) => item.request.assetId),
			),
		).toEqual([
			["gfx-obj/01000001", "gfx-obj/01000002"],
			["landblock-pack/da5fffff"],
			["landblock-summary/da5fffff", "gfx-obj/01000003"],
			["gfx-obj/01000004"],
		]);
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

function createQueuedItem(
	requestId: string,
	assetId: string,
): QueuedPrepareItem {
	return {
		request: createRequest(requestId, assetId),
	};
}

async function waitForMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
