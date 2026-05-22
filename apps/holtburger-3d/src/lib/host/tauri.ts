import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	DebugConfigDto,
} from "./contracts";
import {
	assetLookupResponseDtoSchema,
	cameraHintAckDtoSchema,
	debugConfigDtoSchema,
} from "./contracts";
import { decodeBinaryAssetBatchEnvelope } from "./binary-asset-envelope";
import { getActiveFrontendProfiler } from "../performance/frontend-profiler";
import { z, type ZodType } from "zod";

const MAX_BINARY_LOOKUP_BATCH_SIZE = 4;

export interface BinaryAssetLookupEnvelopeDto {
	payload: ArrayBuffer;
}

declare global {
	interface Window {
		__TAURI_INTERNALS__?: object;
	}
}

function isTauriRuntime(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.__TAURI_INTERNALS__ !== "undefined"
	);
}

function requireTauriRuntime(): void {
	if (!isTauriRuntime()) {
		throw new Error(
			"The Holtburger 3D world viewer requires the Tauri runtime. Start it with npm run tauri:dev.",
		);
	}
}

async function invokeCommand<T>(
	command: string,
	schema: ZodType<T>,
	args?: Record<string, unknown>,
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	const profiler = getActiveFrontendProfiler();
	const payload = await (profiler?.measureAsync(
		"asset-host.invoke",
		{ command },
		() => invoke<unknown>(command, args),
	) ?? invoke<unknown>(command, args));
	return (
		profiler?.measureSync("asset-host.validate-response", { command }, () =>
			schema.parse(payload),
		) ?? schema.parse(payload)
	);
}

export async function readDebugConfig(): Promise<DebugConfigDto> {
	requireTauriRuntime();

	return invokeCommand("get_debug_config", debugConfigDtoSchema);
}

export async function lookupAsset(
	request: AssetLookupRequestDto,
): Promise<AssetLookupResponseDto> {
	const [response] = await lookupAssets([request]);
	if (!response) {
		throw new Error(`No lookup response returned for ${request.assetId}.`);
	}
	return response;
}

export async function lookupAssets(
	requests: readonly AssetLookupRequestDto[],
): Promise<AssetLookupResponseDto[]> {
	requireTauriRuntime();

	if (requests.length === 0) {
		return [];
	}

	const binaryRequests = requests.filter((request) =>
		usesBinaryAssetLookup(request.assetId),
	);
	const jsonRequests = requests.filter(
		(request) => !usesBinaryAssetLookup(request.assetId),
	);
	const responsesByRequestId = new Map<string, AssetLookupResponseDto>();

	await Promise.all(
		planBinaryLookupBatches(binaryRequests).map(async (batch) => {
			for (const response of await lookupBinaryAssetBatch(batch)) {
				responsesByRequestId.set(response.requestId, response);
			}
		}),
	);

	await Promise.all(
		jsonRequests.map(async (request) => {
			const response = await invokeCommand(
				"lookup_asset",
				assetLookupResponseDtoSchema,
				{ request },
			);
			responsesByRequestId.set(request.requestId, response);
		}),
	);

	return requests.map((request) => {
		const response = responsesByRequestId.get(request.requestId);
		if (!response) {
			throw new Error(`No lookup response returned for ${request.assetId}.`);
		}
		return response;
	});
}

async function lookupBinaryAssetBatch(
	requests: readonly AssetLookupRequestDto[],
): Promise<AssetLookupResponseDto[]> {
	const { invoke } = await import("@tauri-apps/api/core");
	const profiler = getActiveFrontendProfiler();
	const payload = await (profiler?.measureAsync(
		"asset-host.invoke",
		{
			command: "lookup_assets_binary",
			requestCount: requests.length,
		},
		() =>
			invoke<unknown>("lookup_assets_binary", {
				batch: { requests },
			}),
	) ??
		invoke<unknown>("lookup_assets_binary", {
			batch: { requests },
		}));
	const byteLength = binaryPayloadByteLength(payload);
	profiler?.recordEvent("asset-host.binary-payload", {
		assetKind: "batch",
		byteLength,
		byteLengthBucket: bucketBytes(byteLength),
		payloadTransportKind: binaryPayloadTransportKind(payload),
		priority: commonPriority(requests),
		requestCount: requests.length,
	});
	const responses =
		profiler?.measureSync(
			"asset-host.decode-binary-envelope",
			{
				byteLength,
				byteLengthBucket: bucketBytes(byteLength),
				payloadTransportKind: binaryPayloadTransportKind(payload),
				requestCount: requests.length,
			},
			() => decodeBinaryAssetBatchEnvelope(payload),
		) ?? decodeBinaryAssetBatchEnvelope(payload);
	return responses.map(
		(response) =>
			profiler?.measureSync(
				"asset-host.validate-response",
				{
					assetId: response.assetId,
					command: "lookup_assets_binary",
				},
				() => assetLookupResponseDtoSchema.parse(response),
			) ?? assetLookupResponseDtoSchema.parse(response),
	);
}

export async function lookupBinaryAssetEnvelopes(
	requests: readonly AssetLookupRequestDto[],
): Promise<BinaryAssetLookupEnvelopeDto[]> {
	requireTauriRuntime();

	if (requests.length === 0) {
		return [];
	}

	const envelopes = await Promise.all(
		planBinaryLookupBatches(requests).map(async (batch) => ({
			payload: normalizeBinaryPayloadToArrayBuffer(
				await invokeRawBinaryLookupBatch(batch),
			),
		})),
	);
	return envelopes;
}

async function invokeRawBinaryLookupBatch(
	requests: readonly AssetLookupRequestDto[],
): Promise<unknown> {
	const { invoke } = await import("@tauri-apps/api/core");
	const profiler = getActiveFrontendProfiler();
	const payload = await (profiler?.measureAsync(
		"asset-host.invoke",
		{
			command: "lookup_assets_binary",
			requestCount: requests.length,
			responseMode: "raw-envelope",
		},
		() =>
			invoke<unknown>("lookup_assets_binary", {
				batch: { requests },
			}),
	) ??
		invoke<unknown>("lookup_assets_binary", {
			batch: { requests },
		}));
	const byteLength = binaryPayloadByteLength(payload);
	profiler?.recordEvent("asset-host.binary-payload", {
		assetKind: "batch",
		byteLength,
		byteLengthBucket: bucketBytes(byteLength),
		payloadTransportKind: binaryPayloadTransportKind(payload),
		priority: commonPriority(requests),
		requestCount: requests.length,
		responseMode: "raw-envelope",
	});
	return payload;
}

function normalizeBinaryPayloadToArrayBuffer(payload: unknown): ArrayBuffer {
	if (payload instanceof ArrayBuffer) {
		return payload;
	}
	if (ArrayBuffer.isView(payload)) {
		const view = new Uint8Array(
			payload.buffer,
			payload.byteOffset,
			payload.byteLength,
		);
		const copy = new Uint8Array(view.byteLength);
		copy.set(view);
		return copy.buffer;
	}
	if (Array.isArray(payload)) {
		return Uint8Array.from(payload).buffer;
	}
	throw new Error("Binary asset response was not returned as bytes.");
}

export function planBinaryLookupBatches(
	requests: readonly AssetLookupRequestDto[],
): AssetLookupRequestDto[][] {
	const batches: AssetLookupRequestDto[][] = [];
	let currentBatch: AssetLookupRequestDto[] = [];

	const flushCurrentBatch = (): void => {
		if (currentBatch.length === 0) {
			return;
		}
		batches.push(currentBatch);
		currentBatch = [];
	};

	for (const request of requests) {
		if (isLargeBinaryAssetLookup(request.assetId)) {
			flushCurrentBatch();
			batches.push([request]);
			continue;
		}

		currentBatch.push(request);
		if (currentBatch.length >= MAX_BINARY_LOOKUP_BATCH_SIZE) {
			flushCurrentBatch();
		}
	}

	flushCurrentBatch();
	return batches;
}

function binaryPayloadByteLength(payload: unknown): number {
	if (payload instanceof ArrayBuffer) {
		return payload.byteLength;
	}
	if (ArrayBuffer.isView(payload)) {
		return payload.byteLength;
	}
	if (Array.isArray(payload)) {
		return payload.length;
	}
	return 0;
}

function binaryPayloadTransportKind(payload: unknown): string {
	if (payload instanceof ArrayBuffer) {
		return "array-buffer";
	}
	if (ArrayBuffer.isView(payload)) {
		return "typed-array";
	}
	if (Array.isArray(payload)) {
		return "number-array";
	}
	return typeof payload;
}

function commonPriority(requests: readonly AssetLookupRequestDto[]): string {
	const [first] = requests;
	if (!first) {
		return "none";
	}
	return requests.every((request) => request.priority === first.priority)
		? first.priority
		: "mixed";
}

function bucketBytes(byteLength: number): string {
	if (byteLength <= 0) {
		return "0";
	}
	if (byteLength < 16 * 1024) {
		return "<16KiB";
	}
	if (byteLength < 64 * 1024) {
		return "16-64KiB";
	}
	if (byteLength < 256 * 1024) {
		return "64-256KiB";
	}
	if (byteLength < 1024 * 1024) {
		return "256KiB-1MiB";
	}
	return ">=1MiB";
}

function usesBinaryAssetLookup(assetId: string): boolean {
	return (
		assetId.startsWith("landblock-pack/") ||
		assetId.startsWith("landblock-summary/") ||
		assetId.startsWith("gfx-obj/")
	);
}

function isLargeBinaryAssetLookup(assetId: string): boolean {
	return assetId.startsWith("landblock-pack/");
}

export async function submitCameraHint(
	hint: CameraHintDto,
): Promise<CameraHintAckDto> {
	requireTauriRuntime();

	return invokeCommand("submit_camera_hint", cameraHintAckDtoSchema, { hint });
}

export async function saveFrontendProfileSummary(
	summary: unknown,
): Promise<string> {
	requireTauriRuntime();

	return invokeCommand("save_frontend_profile_summary", z.string(), {
		summary,
	});
}
