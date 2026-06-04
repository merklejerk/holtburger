import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";
import { decodeBinaryAssetBatchEnvelope } from "../../lib/host/binary-asset-envelope";
import type { WorkerProfileSample } from "./worker-profile";
import {
	measureWorkerProfile,
	measureWorkerProfileAsync,
} from "./worker-profile";

export interface WorkerHostBinaryEnvelope {
	payload: ArrayBuffer;
}

export interface WorkerHostLookupBinaryCompleteMessage {
	type: "host-lookup-assets-binary-complete";
	requestId: string;
	envelopes: WorkerHostBinaryEnvelope[];
}

export interface WorkerHostLookupBinaryErrorMessage {
	type: "host-lookup-assets-binary-error";
	requestId: string;
	message: string;
}

export interface WorkerHostLookupBinaryRequestMessage {
	type: "host-lookup-assets-binary";
	requestId: string;
	requests: AssetLookupRequestDto[];
}

export interface WorkerHostAssetLookupResult {
	responses: AssetLookupResponseDto[];
	profileSamples: WorkerProfileSample[];
}

export interface WorkerHostAssetBridgeScope {
	postMessage?: (
		message: WorkerHostLookupBinaryRequestMessage,
		transfer?: Transferable[],
	) => void;
}

export class WorkerHostAssetBridge {
	private nextRequestIndex = 1;
	private readonly pendingLookups = new Map<
		string,
		{
			resolve: (envelopes: WorkerHostBinaryEnvelope[]) => void;
			reject: (error: Error) => void;
		}
	>();

	constructor(
		private readonly workerScope: WorkerHostAssetBridgeScope,
		private readonly options: {
			requestIdPrefix: string;
			profileLabelPrefix: string;
		},
	) {}

	async lookupBinaryAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<WorkerHostAssetLookupResult> {
		if (requests.length === 0) {
			return {
				responses: [],
				profileSamples: [],
			};
		}

		const profileSamples: WorkerProfileSample[] = [];
		const envelopes = await measureWorkerProfileAsync(
			`${this.options.profileLabelPrefix}.hostLookup.awaitHost`,
			() => this.requestBinaryEnvelopes(requests),
			profileSamples,
		);
		const responses = measureWorkerProfile(
			`${this.options.profileLabelPrefix}.hostLookup.decodeEnvelope`,
			() =>
				envelopes.flatMap((envelope) =>
					decodeBinaryAssetBatchEnvelope(envelope.payload),
				),
			profileSamples,
		);
		const missingPayloadResponses = responses.filter(
			(response) => response.payload === undefined,
		);
		if (missingPayloadResponses.length > 0) {
			throw new Error(
				`Host binary lookup decoded ${missingPayloadResponses.length} response(s) without payload: ${JSON.stringify(
					missingPayloadResponses.map((response) => ({
						requestId: response.requestId,
						assetId: response.assetId,
						payloadKind: response.payloadKind,
						keys: Object.keys(response),
					})),
				)}.`,
			);
		}
		return {
			responses,
			profileSamples,
		};
	}

	resolve(message: WorkerHostLookupBinaryCompleteMessage): void {
		const pending = this.pendingLookups.get(message.requestId);
		if (!pending) {
			return;
		}
		this.pendingLookups.delete(message.requestId);
		pending.resolve(message.envelopes);
	}

	reject(message: WorkerHostLookupBinaryErrorMessage): void {
		const pending = this.pendingLookups.get(message.requestId);
		if (!pending) {
			return;
		}
		this.pendingLookups.delete(message.requestId);
		pending.reject(new Error(message.message));
	}

	private requestBinaryEnvelopes(
		requests: readonly AssetLookupRequestDto[],
	): Promise<WorkerHostBinaryEnvelope[]> {
		const requestId = `${this.options.requestIdPrefix}-${this.nextRequestIndex++}`;
		return new Promise((resolve, reject) => {
			this.pendingLookups.set(requestId, { resolve, reject });
			this.workerScope.postMessage?.({
				type: "host-lookup-assets-binary",
				requestId,
				requests: [...requests],
			});
		});
	}
}
