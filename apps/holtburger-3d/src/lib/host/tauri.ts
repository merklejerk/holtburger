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
import type { ZodType } from "zod";

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
	const payload = await invoke<unknown>(command, args);
	return schema.parse(payload);
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
	const payload = await invoke<unknown>("lookup_assets_binary", {
		batch: { requests },
	});
	const responses = decodeBinaryAssetBatchEnvelope(payload);
	return responses.map((response) =>
		assetLookupResponseDtoSchema.parse(response),
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
	return invoke<unknown>("lookup_assets_binary", {
		batch: { requests },
	});
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

function usesBinaryAssetLookup(assetId: string): boolean {
	return (
		assetId.startsWith("landblock-pack/") ||
		assetId.startsWith("landblock-summary/") ||
		assetId.startsWith("gfx-obj/") ||
		assetId.startsWith("render-surface/")
	);
}

function isLargeBinaryAssetLookup(assetId: string): boolean {
	return (
		assetId.startsWith("landblock-pack/") ||
		assetId.startsWith("render-surface/")
	);
}

export async function submitCameraHint(
	hint: CameraHintDto,
): Promise<CameraHintAckDto> {
	requireTauriRuntime();

	return invokeCommand("submit_camera_hint", cameraHintAckDtoSchema, { hint });
}
