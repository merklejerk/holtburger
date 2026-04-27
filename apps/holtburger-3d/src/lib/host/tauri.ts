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
	return {
		tick,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
	};
}


function fallbackViewModelFeed(_tick = 1): FrontendStateFeedDto {
	return {
		selectedEntityId: null,
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
	const terrainLandblockId = parseTerrainAssetId(request.assetId);
	if (terrainLandblockId !== null) {
		return createFallbackTerrainResponse(request, terrainLandblockId);
	}

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
			kind: "visual-asset-stub",
			residencyKind,
			debugPrimitive,
			paletteKey,
			notes: [
				"Browser preview is exercising the dedicated asset channel without using the runtime snapshot.",
				"This is an app-local visual asset stub, not a final renderer bundle chosen by Rust.",
				"The renderer is expected to choose concrete asset requests from runtime visual facts once real asset families land.",
			],
		},
	};
}

function createFallbackTerrainResponse(
	request: AssetLookupRequestDto,
	landblockId: number,
): AssetLookupResponseDto {
	const heights: number[] = [];
	const terrainTypes: number[] = [];
	for (let row = 0; row < 9; row += 1) {
		for (let col = 0; col < 9; col += 1) {
			const height =
				18 +
				Math.sin((landblockId & 0xff) * 0.015 + col * 0.42) * 10 +
				Math.cos(((landblockId >>> 8) & 0xff) * 0.02 + row * 0.37) * 8;
			heights.push(Number(height.toFixed(3)));
			terrainTypes.push((row + col + (landblockId & 0x0f)) % 6);
		}
	}

	return {
		requestId: request.requestId,
		assetId: request.assetId,
		payloadKind: 'json',
		payload: {
			kind: 'terrain-landblock',
			residencyKind: 'outdoor-landblock',
			landblockId,
			gridSize: 9,
			tileSize: 24,
			heights,
			terrainTypes,
			notes: [
				'Browser preview uses a deterministic generated placeholder terrain surface so the Phase 9 world browser stays visible outside Tauri.',
				'Live Tauri terrain requests should resolve CellLandblock data from repo-local content instead of this preview placeholder surface.',
			],
		},
	};
}

function parseTerrainAssetId(assetId: string): number | null {
	if (!assetId.startsWith('terrain/')) {
		return null;
	}

	const hex = assetId.slice('terrain/'.length);
	return /^[0-9a-fA-F]{8}$/.test(hex) ? Number.parseInt(hex, 16) : null;
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
		return {
			requestId: request.requestId,
			resolved: false,
			cameraHintSequence: null,
			hit: null,
			summary: "Browser preview has no runtime fixture entities to resolve against.",
		};
	}

	return invokeCommand<RayPickResponseDto>("resolve_ray_pick", { request });
}
