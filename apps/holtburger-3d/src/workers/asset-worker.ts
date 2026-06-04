import { classifyAssetRequestProfileKind } from "../lib/assets/asset-hydration-policy";
import type { PreparedAssetRecord } from "../lib/assets/types";
import type { AssetLookupRequestDto } from "../lib/host/contracts";
import { prepareAssetPayload } from "./shared/asset-prepare";
import type {
	WorkerHostAssetLookupResult,
	WorkerHostBinaryEnvelope,
	WorkerHostLookupBinaryCompleteMessage,
	WorkerHostLookupBinaryErrorMessage,
	WorkerHostLookupBinaryRequestMessage,
} from "./shared/host-asset-bridge";
import { WorkerHostAssetBridge } from "./shared/host-asset-bridge";
import { prepareAssetForPostMessage } from "./shared/transferables";
import type { WorkerProfileSample } from "./shared/worker-profile";
import {
	measureWorkerProfile,
	measureWorkerProfileAsync,
} from "./shared/worker-profile";

export type AssetWorkerProfileSample = WorkerProfileSample;
export type AssetWorkerHostBinaryEnvelope = WorkerHostBinaryEnvelope;
export type AssetWorkerHostLookupBinaryCompleteMessage =
	WorkerHostLookupBinaryCompleteMessage;
export type AssetWorkerHostLookupBinaryErrorMessage =
	WorkerHostLookupBinaryErrorMessage;
export type AssetWorkerHostLookupBinaryRequestMessage =
	WorkerHostLookupBinaryRequestMessage;

export interface AssetWorkerPrepareBatchRequest {
	type: "prepare-assets";
	items: AssetWorkerPrepareBatchItem[];
}

export interface AssetWorkerPrepareBatchItem {
	request: AssetLookupRequestDto;
}

export interface AssetWorkerPreparedAssetMessage {
	type: "asset-ready";
	asset: PreparedAssetRecord;
}

export interface AssetWorkerErrorMessage {
	type: "asset-error";
	requestId: string;
	assetId: string;
	message: string;
}

export interface AssetWorkerPreparedBatchMessage {
	type: "assets-prepared";
	results: AssetWorkerPreparedResult[];
	profileSamples?: WorkerProfileSample[];
}

export type AssetWorkerRequestMessage =
	| AssetWorkerPrepareBatchRequest
	| WorkerHostLookupBinaryCompleteMessage
	| WorkerHostLookupBinaryErrorMessage;
export type AssetWorkerPreparedResult =
	| AssetWorkerPreparedAssetMessage
	| AssetWorkerErrorMessage;
export type AssetWorkerResponseMessage =
	| AssetWorkerPreparedBatchMessage
	| WorkerHostLookupBinaryRequestMessage;

type AssetWorkerRuntimeScope = typeof globalThis & {
	onmessage?: ((event: MessageEvent<AssetWorkerRequestMessage>) => void) | null;
	postMessage?: (
		message: AssetWorkerResponseMessage,
		transfer?: Transferable[],
	) => void;
	document?: unknown;
};

const workerScope = globalThis as AssetWorkerRuntimeScope;
const ASSET_WORKER_DIAGNOSTIC_BUILD = "asset-worker-diag-2026-05-24a";

class AssetWorkerPrepareScheduler {
	constructor(
		private readonly hostBridge: WorkerHostAssetBridge,
		private readonly workerScope: AssetWorkerRuntimeScope,
	) {}

	enqueue(items: readonly AssetWorkerPrepareBatchItem[]): void {
		if (items.length === 0) {
			return;
		}
		void this.processBatch(items.map((item) => ({ ...item })));
	}

	private async processBatch(
		items: readonly AssetWorkerPrepareBatchItem[],
	): Promise<void> {
		const results: AssetWorkerPreparedResult[] = [];
		const profileSamples: WorkerProfileSample[] = [];
		const transferables: Transferable[] = [];
		let lookupResult: WorkerHostAssetLookupResult;

		try {
			lookupResult = await measureWorkerProfileAsync(
				"asset-worker.lookupBinaryAssets",
				() =>
					this.hostBridge.lookupBinaryAssets(items.map((item) => item.request)),
				profileSamples,
			);
		} catch (error) {
			this.postBatchError(items, error);
			return;
		}
		profileSamples.push(...lookupResult.profileSamples);

		const responsesByRequestId = new Map(
			lookupResult.responses.map((response) => [response.requestId, response]),
		);
		const preparedAssets: PreparedAssetRecord[] = [];

		for (const item of items) {
			try {
				const response = responsesByRequestId.get(item.request.requestId);
				if (!response) {
					throw new Error(
						`Host binary lookup did not return ${item.request.assetId}.`,
					);
				}
				const requestKind = classifyAssetRequestProfileKind(
					item.request.assetId,
				);
				const asset = measureWorkerProfile(
					`asset-worker.preparePayload.${requestKind}`,
					() => prepareAssetPayload(item.request, response),
					profileSamples,
				);
				measureWorkerProfile(
					`asset-worker.prepareTransfer.${asset.payload.kind}`,
					() => {
						transferables.push(...prepareAssetForPostMessage(asset));
					},
					profileSamples,
				);
				preparedAssets.push(asset);
			} catch (error) {
				results.push({
					type: "asset-error",
					requestId: item.request.requestId,
					assetId: item.request.assetId,
					message: formatWorkerDiagnosticError(error),
				});
			}
		}

		for (const asset of preparedAssets) {
			results.push({
				type: "asset-ready",
				asset,
			});
		}
		this.workerScope.postMessage?.(
			{
				type: "assets-prepared",
				results,
				profileSamples,
			},
			transferables,
		);
	}

	private postBatchError(
		items: readonly AssetWorkerPrepareBatchItem[],
		error: unknown,
	): void {
		this.workerScope.postMessage?.({
			type: "assets-prepared",
			results: items.map((item) => ({
				type: "asset-error",
				requestId: item.request.requestId,
				assetId: item.request.assetId,
				message: formatWorkerDiagnosticError(error),
			})),
		});
	}
}

function formatWorkerDiagnosticError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `[${ASSET_WORKER_DIAGNOSTIC_BUILD}] ${message}`;
}

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	const hostBridge = new WorkerHostAssetBridge(workerScope, {
		requestIdPrefix: "asset-worker-host",
		profileLabelPrefix: "asset-worker",
	});
	const prepareScheduler = new AssetWorkerPrepareScheduler(
		hostBridge,
		workerScope,
	);
	workerScope.onmessage = async (
		event: MessageEvent<AssetWorkerRequestMessage>,
	) => {
		if (event.data.type === "host-lookup-assets-binary-complete") {
			hostBridge.resolve(event.data);
			return;
		}
		if (event.data.type === "host-lookup-assets-binary-error") {
			hostBridge.reject(event.data);
			return;
		}
		prepareScheduler.enqueue(event.data.items);
	};
}
