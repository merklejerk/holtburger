import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	FrontendStateFeedDto,
	HostBoundaryOverviewDto,
	HostBoundarySnapshot,
	LifecycleStateDto,
	RayPickRequestDto,
	RayPickResponseDto,
	RuntimeBatchDto,
	RuntimeNotificationEnvelopeDto,
} from "./contracts";

const RUNTIME_NOTIFICATION_EVENT = "runtime:notification";
const PREVIEW_RUNTIME_INTERVAL_MS = 1_000;
const PREVIEW_LOCAL_PLAYER_ID = 0x01020304;
const PREVIEW_DRUDGE_ID = 0x01020305;
const PREVIEW_SENTINEL_ID = 0x01020306;

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

function fallbackLifecycleState(): LifecycleStateDto {
	return {
		phase: "ready",
		activeModeHint: "browser",
		sessionState: "unavailable",
		summary:
			"Browser preview fallback mirrors the host boundary shape until the Tauri runtime is active.",
	};
}

function fallbackRuntimeBatch(tick = 1): RuntimeBatchDto {
	const orbit = tick * 0.2;

	return {
		tick,
		entities: [
			{
				entityId: PREVIEW_LOCAL_PLAYER_ID,
				label: "Browser Scout",
				position: {
					x: 12 + Math.cos(orbit) * 1.5,
					y: -4.5 + Math.sin(orbit) * 1.2,
					z: 1,
				},
				headingRadians: orbit,
				appearanceId: "gfx/02000001",
				landblockId: 0x01020003,
				cellId: 3,
				locationLabel: "100.40S, 101.55W, 1.0Z",
				isLocalPlayer: true,
			},
			{
				entityId: PREVIEW_DRUDGE_ID,
				label: "Survey Drudge",
				position: { x: 18, y: -1 + Math.sin(orbit) * 0.6, z: 0 },
				headingRadians: Math.PI / 2 + orbit * 0.25,
				appearanceId: "gfx/02000002",
				landblockId: 0x0102001b,
				cellId: 27,
				locationLabel: "100.41S, 101.52W, 0.0Z",
				isLocalPlayer: false,
			},
			{
				entityId: PREVIEW_SENTINEL_ID,
				label: "Dungeon Sentinel",
				position: { x: 9, y: 14, z: -6 + Math.cos(orbit) * 0.3 },
				headingRadians: Math.PI + orbit * 0.15,
				appearanceId: "gfx/02000003",
				landblockId: 0x016c0155,
				cellId: 0x155,
				locationLabel: "Dungeon approach",
				isLocalPlayer: false,
			},
		],
		residency: {
			focusEntityId: PREVIEW_LOCAL_PLAYER_ID,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 3,
		},
	};
}


function fallbackViewModelFeed(tick = 1): FrontendStateFeedDto {
	return {
		selectedEntityId:
			tick <= 1
				? PREVIEW_LOCAL_PLAYER_ID
				: tick % 2 === 0
					? PREVIEW_DRUDGE_ID
					: PREVIEW_SENTINEL_ID,
		interactionMode: "inspect",
		busyState: "idle",
	};
}

function fallbackRuntimeNotification(tick: number): RuntimeNotificationEnvelopeDto {
	return {
		channel: "runtime",
		topic: "runtime.batch",
		lifecycleState: null,
		runtimeBatch: fallbackRuntimeBatch(tick),
		viewModelFeed: fallbackViewModelFeed(tick),
	};
}

function fallbackOverview(): HostBoundaryOverviewDto {
	return {
		assetChannel: "asset",
		runtimeChannel: "runtime",
		runtimeNotificationEvent: "runtime:notification",
		runtimeLifecycleTopic: "lifecycle.state",
		runtimeBatchCommand: "get_runtime_batch",
		assetLookupCommand: "lookup_asset",
		notes: [
			"Browser preview is using app-local fallback data instead of the live host runtime.",
			"The same runtime and asset channel contract shapes are preserved in preview mode.",
		],
	};
}

function fallbackAssetResponse(
	request: AssetLookupRequestDto,
): AssetLookupResponseDto {
	const residencyKind =
		request.assetId === "gfx/02000003"
			? "indoor-env-cell"
			: "outdoor-landblock";
	const debugPrimitive =
		request.assetId === "gfx/02000003"
			? "sentinel-proxy-volume"
			: request.assetId === "gfx/02000002"
				? "drudge-proxy-mesh"
				: "survey-billboard";
	const paletteKey =
		request.assetId === "gfx/02000003"
			? "dungeon-sentinel"
			: request.assetId === "gfx/02000002"
				? "rust-drudge"
				: "bronze-scout";

	return {
		requestId: request.requestId,
		assetId: request.assetId,
		payloadKind: "json",
		payload: {
			kind: "appearance-manifest",
			residencyKind,
			debugPrimitive,
			paletteKey,
			notes: [
				"Browser preview is exercising the dedicated asset channel without using the runtime snapshot.",
				"The worker should prepare this payload before the renderer consumes it.",
			],
		},
	};
}

async function invokeCommand<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(command, args);
}

export async function readHostBoundarySnapshot(): Promise<HostBoundarySnapshot> {
	if (!isTauriRuntime()) {
		return {
			source: "browser-preview",
			lifecycleState: fallbackLifecycleState(),
			runtimeBatch: fallbackRuntimeBatch(),
			viewModelFeed: fallbackViewModelFeed(),
			overview: fallbackOverview(),
		};
	}

	const [lifecycleState, runtimeBatch, viewModelFeed, overview] =
		await Promise.all([
			invokeCommand<LifecycleStateDto>("get_lifecycle_state"),
			invokeCommand<RuntimeBatchDto>("get_runtime_batch"),
			invokeCommand<FrontendStateFeedDto>("get_view_model_feed"),
			invokeCommand<HostBoundaryOverviewDto>("get_host_boundary_overview"),
		]);

	return {
		source: "tauri",
		lifecycleState,
		runtimeBatch,
		viewModelFeed,
		overview,
	};
}

export async function lookupAsset(
	request: AssetLookupRequestDto,
): Promise<AssetLookupResponseDto> {
	if (!isTauriRuntime()) {
		return fallbackAssetResponse(request);
	}

	return invokeCommand<AssetLookupResponseDto>("lookup_asset", { request });
}

export async function listenForRuntimeLifecycle(
	onNotification: (notification: RuntimeNotificationEnvelopeDto) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) {
		let tick = 1;
		const interval = setInterval(() => {
			tick += 1;
			onNotification(fallbackRuntimeNotification(tick));
		}, PREVIEW_RUNTIME_INTERVAL_MS);

		return () => {
			clearInterval(interval);
		};
	}

	const { listen } = await import("@tauri-apps/api/event");
	const unlisten = await listen<RuntimeNotificationEnvelopeDto>(
		RUNTIME_NOTIFICATION_EVENT,
		(event) => onNotification(event.payload),
	);

	return () => {
		unlisten();
	};
}

export async function submitCameraHint(
	hint: CameraHintDto,
): Promise<CameraHintAckDto> {
	if (!isTauriRuntime()) {
		return {
			accepted: true,
			sequence: Math.round(
				hint.viewportNormalizedX * 1000 + hint.viewportNormalizedY * 1000,
			),
			summary: `Browser preview accepted a camera hint toward ${hint.destinationLabel ?? "the runtime focus"}.`,
		};
	}

	return invokeCommand<CameraHintAckDto>("submit_camera_hint", { hint });
}

export async function resolveRayPick(
	request: RayPickRequestDto,
): Promise<RayPickResponseDto> {
	if (!isTauriRuntime()) {
		const batch = fallbackRuntimeBatch();
		const hit =
			request.screenXNormalized >= 0.5 ? batch.entities[1] : batch.entities[0];

		return {
			requestId: request.requestId,
			resolved: true,
			cameraHintSequence: null,
			hit: {
				entityId: hit.entityId,
				label: hit.label,
				locationLabel: hit.locationLabel,
				distance: Math.hypot(
					hit.position.x - request.origin.x,
					hit.position.y - request.origin.y,
					hit.position.z - request.origin.z,
				),
			},
			summary: `Browser preview resolved the debug ray pick against ${hit.label}.`,
		};
	}

	return invokeCommand<RayPickResponseDto>("resolve_ray_pick", { request });
}
