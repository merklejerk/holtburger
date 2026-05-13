import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	DebugConfigDto,
	HostBoundarySnapshot,
	RayPickRequestDto,
	RayPickResponseDto,
	RuntimeNotificationEnvelopeDto,
} from "./contracts";
import {
	assetLookupResponseDtoSchema,
	cameraHintAckDtoSchema,
	debugConfigDtoSchema,
	frontendStateFeedDtoSchema,
	hostBoundaryOverviewDtoSchema,
	lifecycleStateDtoSchema,
	rayPickResponseDtoSchema,
	runtimeBatchDtoSchema,
	runtimeNotificationEnvelopeDtoSchema,
} from "./contracts";
import type { ZodType } from "zod";

const RUNTIME_NOTIFICATION_EVENT = "runtime:notification";

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

export async function readHostBoundarySnapshot(): Promise<HostBoundarySnapshot> {
	requireTauriRuntime();

	const [lifecycleState, runtimeBatch, viewModelFeed, overview] =
		await Promise.all([
			invokeCommand("get_lifecycle_state", lifecycleStateDtoSchema),
			invokeCommand("get_runtime_batch", runtimeBatchDtoSchema),
			invokeCommand("get_view_model_feed", frontendStateFeedDtoSchema),
			invokeCommand(
				"get_host_boundary_overview",
				hostBoundaryOverviewDtoSchema,
			),
		]);

	return {
		source: "tauri",
		lifecycleState,
		runtimeBatch,
		viewModelFeed,
		overview,
	};
}

export async function readDebugConfig(): Promise<DebugConfigDto> {
	requireTauriRuntime();

	return invokeCommand("get_debug_config", debugConfigDtoSchema);
}

export async function lookupAsset(
	request: AssetLookupRequestDto,
): Promise<AssetLookupResponseDto> {
	requireTauriRuntime();

	return invokeCommand("lookup_asset", assetLookupResponseDtoSchema, {
		request,
	});
}

export async function listenForRuntimeLifecycle(
	onNotification: (notification: RuntimeNotificationEnvelopeDto) => void,
): Promise<() => void> {
	requireTauriRuntime();

	const { listen } = await import("@tauri-apps/api/event");
	const unlisten = await listen<RuntimeNotificationEnvelopeDto>(
		RUNTIME_NOTIFICATION_EVENT,
		(event) =>
			onNotification(runtimeNotificationEnvelopeDtoSchema.parse(event.payload)),
	);

	return () => {
		unlisten();
	};
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
