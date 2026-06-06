import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	DebugConfigDto,
} from "./contracts";
import {
	assetLookupResponseDtoSchema,
	debugConfigDtoSchema,
} from "./contracts";
import {
	decodeBinaryAssetBatchEnvelope,
	encodeJsonAssetBatchEnvelope,
} from "./binary-asset-envelope";
import type { ZodType } from "zod";

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

async function lookupAssets(
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

	const plan = planAssetLookupEnvelopeRequests(requests);
	const binaryEnvelopes = await Promise.all(
		plan.binaryBatches.map(async (batch) => ({
			payload: normalizeBinaryPayloadToArrayBuffer(
				await invokeRawBinaryLookupBatch(batch),
			),
		})),
	);
	const jsonResponses = await Promise.all(
		plan.jsonRequests.map((request) =>
			invokeCommand("lookup_asset", assetLookupResponseDtoSchema, { request }),
		),
	);
	const jsonEnvelopes =
		jsonResponses.length === 0
			? []
			: [{ payload: encodeJsonAssetBatchEnvelope(jsonResponses) }];
	return [...binaryEnvelopes, ...jsonEnvelopes];
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
	return requests.length === 0 ? [] : [[...requests]];
}

export interface AssetLookupEnvelopePlan {
	binaryBatches: AssetLookupRequestDto[][];
	jsonRequests: AssetLookupRequestDto[];
}

export function planAssetLookupEnvelopeRequests(
	requests: readonly AssetLookupRequestDto[],
): AssetLookupEnvelopePlan {
	const binaryRequests = requests.filter((request) =>
		usesBinaryAssetLookup(request.assetId),
	);
	return {
		binaryBatches: planBinaryLookupBatches(binaryRequests),
		jsonRequests: requests.filter(
			(request) => !usesBinaryAssetLookup(request.assetId),
		),
	};
}

function usesBinaryAssetLookup(assetId: string): boolean {
	return (
		/^landblock\/[0-9a-fA-F]{8}\/(?:outdoor|topology)$/.test(assetId) ||
		/^env-cell\/[0-9a-fA-F]{8}$/.test(assetId) ||
		assetId.startsWith("gfx-obj/") ||
		assetId.startsWith("prepared-texture/") ||
		assetId.startsWith("render-surface/") ||
		assetId.startsWith("palette/")
	);
}
