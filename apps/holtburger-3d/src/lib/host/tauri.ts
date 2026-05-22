import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	DebugConfigDto,
	RayPickRequestDto,
	RayPickResponseDto,
} from "./contracts";
import {
	assetLookupResponseDtoSchema,
	cameraHintAckDtoSchema,
	debugConfigDtoSchema,
	rayPickResponseDtoSchema,
} from "./contracts";
import { decodeBinaryAssetEnvelope } from "./binary-asset-envelope";
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

export async function readDebugConfig(): Promise<DebugConfigDto> {
	requireTauriRuntime();

	return invokeCommand("get_debug_config", debugConfigDtoSchema);
}

export async function lookupAsset(
	request: AssetLookupRequestDto,
): Promise<AssetLookupResponseDto> {
	requireTauriRuntime();

	if (usesBinaryAssetLookup(request.assetId)) {
		const { invoke } = await import("@tauri-apps/api/core");
		const payload = await invoke<unknown>("lookup_asset_binary", { request });
		return assetLookupResponseDtoSchema.parse(
			decodeBinaryAssetEnvelope(payload),
		);
	}

	return invokeCommand("lookup_asset", assetLookupResponseDtoSchema, {
		request,
	});
}

function usesBinaryAssetLookup(assetId: string): boolean {
	return (
		assetId.startsWith("landblock-pack/") ||
		assetId.startsWith("landblock-summary/") ||
		assetId.startsWith("gfx-obj/")
	);
}

export async function submitCameraHint(
	hint: CameraHintDto,
): Promise<CameraHintAckDto> {
	requireTauriRuntime();

	return invokeCommand("submit_camera_hint", cameraHintAckDtoSchema, { hint });
}

export async function resolveRayPick(
	request: RayPickRequestDto,
): Promise<RayPickResponseDto> {
	requireTauriRuntime();

	return invokeCommand("resolve_ray_pick", rayPickResponseDtoSchema, {
		request,
	});
}
