import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../lib/host/contracts";
import type { AssetResidencyKind, PreparedAssetRecord } from "../lib/assets/types";

export interface AssetWorkerPrepareRequest {
	type: "prepare-asset";
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
}

export interface AssetWorkerReadyMessage {
	type: "asset-ready";
	asset: PreparedAssetRecord;
}

export interface AssetWorkerErrorMessage {
	type: "asset-error";
	requestId: string;
	assetId: string;
	message: string;
}

export type AssetWorkerRequestMessage = AssetWorkerPrepareRequest;
export type AssetWorkerResponseMessage =
	| AssetWorkerReadyMessage
	| AssetWorkerErrorMessage;

export function prepareAssetPayload(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
): PreparedAssetRecord {
	const payload = asRecord(response.payload);
	const residencyKind = parseResidencyKind(payload.residencyKind);
	const debugPrimitive = asString(payload.debugPrimitive) ?? "json-manifest";
	const paletteKey = asString(payload.paletteKey) ?? "debug-default";
	const notes = asStringArray(payload.notes);

	return {
		request,
		response,
		residencyKind,
		debugPrimitive,
		paletteKey,
		summary: `Prepared ${request.assetId} as ${debugPrimitive} for ${residencyKind}.`,
		notes,
		preparedAt: new Date().toISOString(),
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Asset worker expected an object payload for CPU-side preparation.");
	}

	return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === "string");
}

function parseResidencyKind(value: unknown): AssetResidencyKind {
	if (
		value === "outdoor-landblock" ||
		value === "indoor-env-cell" ||
		value === "unknown"
	) {
		return value;
	}

	return "unknown";
}

const workerScope = globalThis as typeof globalThis & {
	onmessage?: ((event: MessageEvent<AssetWorkerRequestMessage>) => void) | null;
	postMessage?: (message: AssetWorkerResponseMessage) => void;
	document?: unknown;
};

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	workerScope.onmessage = (event: MessageEvent<AssetWorkerRequestMessage>) => {
		try {
			const asset = prepareAssetPayload(event.data.request, event.data.response);
			workerScope.postMessage?.({
				type: "asset-ready",
				asset,
			});
		} catch (error) {
			workerScope.postMessage?.({
				type: "asset-error",
				requestId: event.data.request.requestId,
				assetId: event.data.request.assetId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};
}
