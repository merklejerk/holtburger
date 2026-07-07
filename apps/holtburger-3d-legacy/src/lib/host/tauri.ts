import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	ResolveWeenieSpawnSeedRequestDto,
	WeenieLookupCapabilityDto,
	WeenieSpawnSeedDto,
} from "./contracts";
import {
	assetLookupResponseDtoSchema,
	weenieLookupCapabilityDtoSchema,
	weenieSpawnSeedDtoSchema,
} from "./contracts";
import { decodeBinaryAssetBatchEnvelope } from "./binary-asset-envelope";
import type { ZodType } from "zod";

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

export async function lookupAsset(
	request: AssetLookupRequestDto,
): Promise<AssetLookupResponseDto> {
	const [response] = await lookupAssets([request]);
	if (!response) {
		throw new Error(`No lookup response returned for ${request.assetId}.`);
	}
	return response;
}

export async function getWeenieLookupCapability(): Promise<WeenieLookupCapabilityDto> {
	requireTauriRuntime();
	return invokeCommand(
		"get_weenie_lookup_capability",
		weenieLookupCapabilityDtoSchema,
	);
}

export async function resolveWeenieSpawnSeed(
	request: ResolveWeenieSpawnSeedRequestDto,
): Promise<WeenieSpawnSeedDto | null> {
	requireTauriRuntime();
	return invokeCommand(
		"resolve_weenie_spawn_seed",
		weenieSpawnSeedDtoSchema.nullable(),
		{ request },
	);
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

export function planBinaryLookupBatches(
	requests: readonly AssetLookupRequestDto[],
): AssetLookupRequestDto[][] {
	return requests.length === 0 ? [] : [[...requests]];
}

export function usesBinaryAssetLookup(assetId: string): boolean {
	return (
		/^landblock\/[0-9a-fA-F]{8}\/lod\/[0-4]$/.test(assetId) ||
		/^env-cell\/[0-9a-fA-F]{8}$/.test(assetId) ||
		assetId.startsWith("gfx-obj/") ||
		assetId.startsWith("prepared-texture/") ||
		assetId.startsWith("prepared-palette-texture/") ||
		assetId.startsWith("render-surface/") ||
		assetId.startsWith("palette/")
	);
}
