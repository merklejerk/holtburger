import { writable } from "svelte/store";

import { availableModes, type AppModeId } from "./modes";
import {
	createBrowserModeState,
	previewBrowserLocation,
	seedBrowserDraftFromResidency,
	selectRuntimeResidencyDestination,
	updateBrowserDraft,
	type BrowserModeState,
} from "./browser-mode";
import {
	createInitialAssetChannelState,
	type AssetActivityRecord,
	type AssetChannelState,
	type PreparedAssetRecord,
} from "../lib/assets/types";
import type {
	AssetLookupRequestDto,
	HostBoundarySnapshot,
	LifecycleStateDto,
	RuntimeNotificationEnvelopeDto,
} from "../lib/host/contracts";

export interface HostConnectionState {
	boundarySnapshot: HostBoundarySnapshot | null;
	latestRuntimeNotification: RuntimeNotificationEnvelopeDto | null;
	boundaryStatus: string;
}

export interface ModeState {
	activeMode: AppModeId;
	activeModeLabel: string;
	activeModeSummary: string;
	activePageId: string;
	routingReason: string;
}

export interface FrontendAppState {
	host: HostConnectionState;
	asset: AssetChannelState;
	browserMode: BrowserModeState;
	mode: ModeState;
}

const DEFAULT_BOUNDARY_STATUS = "Loading host boundary...";
const MAX_ASSET_ACTIVITY = 8;

export function createInitialFrontendState(): FrontendAppState {
	return reconcileModeState({
		host: {
			boundarySnapshot: null,
			latestRuntimeNotification: null,
			boundaryStatus: DEFAULT_BOUNDARY_STATUS,
		},
			asset: createInitialAssetChannelState(),
		browserMode: createBrowserModeState(),
		mode: createModeState(
			"browser",
			"location-entry",
			"Browser mode is the default until lifecycle facts say otherwise.",
		),
	});
}

export function mergeHostBoundarySnapshot(
	boundarySnapshot: HostBoundarySnapshot,
	notification: RuntimeNotificationEnvelopeDto,
): HostBoundarySnapshot {
	return {
		...boundarySnapshot,
		lifecycleState:
			notification.lifecycleState ?? boundarySnapshot.lifecycleState,
		runtimeBatch: notification.runtimeBatch ?? boundarySnapshot.runtimeBatch,
		viewModelFeed: notification.viewModelFeed ?? boundarySnapshot.viewModelFeed,
	};
}

export function deriveModeState(
	lifecycleState: LifecycleStateDto | null,
	browserMode: BrowserModeState,
): ModeState {
	if (browserMode.destination) {
		return createModeState(
			"browser",
			browserMode.page,
			"A browser-mode destination has been selected, so frontend policy keeps the browser flow active.",
		);
	}

	if (
		lifecycleState?.activeModeHint === "client" &&
		lifecycleState.phase === "ready" &&
		lifecycleState.sessionState === "connected"
	) {
		return createModeState(
			"client",
			"session-live",
			"The host lifecycle reports a ready connected client session, so frontend policy routes to client mode.",
		);
	}

	if (lifecycleState?.activeModeHint === "client") {
		return createModeState(
			"client",
			"client-placeholder",
			"The host is steering toward client mode, but the browser flow remains dormant until a connected session exists.",
		);
	}

	return createModeState(
		"browser",
		browserMode.page,
		"Browser mode stays frontend-owned and remains the default when lifecycle facts do not require client mode.",
	);
}

export function createFrontendStateStore() {
	const { subscribe, update } = writable<FrontendAppState>(
		createInitialFrontendState(),
	);

	return {
		subscribe,
		loadSnapshot(snapshot: HostBoundarySnapshot): void {
			update((state) =>
				reconcileModeState(applyLoadedSnapshot(state, snapshot)),
			);
		},
		applyRuntimeNotification(
			notification: RuntimeNotificationEnvelopeDto,
		): void {
			update((state) =>
				reconcileModeState(applyRuntimeNotification(state, notification)),
			);
		},
		updateBrowserDraft(draftInput: string): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateBrowserDraft(state.browserMode, draftInput),
				}),
			);
		},
		previewBrowserLocation(): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: previewBrowserLocation(state.browserMode),
				}),
			);
		},
		markAssetPending(request: AssetLookupRequestDto): void {
			update((state) => ({
				...state,
				asset: {
					...state.asset,
					status: "pending",
					activeRequest: request,
					errorMessage: null,
					history: appendAssetActivity(state.asset.history, {
						requestId: request.requestId,
						assetId: request.assetId,
						priority: request.priority,
						status: "requested",
						channel: state.asset.channel,
						summary: `Queued ${request.assetId} for ${request.priority} preparation.`,
						timestamp: new Date().toISOString(),
					}),
				},
			}));
		},
		applyPreparedAsset(asset: PreparedAssetRecord): void {
			update((state) => ({
				...state,
				asset: {
					...state.asset,
					status: "ready",
					activeRequest: asset.request,
					preparedAsset: asset,
					preparedByPriority: {
						...state.asset.preparedByPriority,
						[asset.request.priority]: asset,
					},
					lastResponse: asset.response,
					errorMessage: null,
					history: appendAssetActivity(state.asset.history, {
						requestId: asset.request.requestId,
						assetId: asset.request.assetId,
						priority: asset.request.priority,
						status: "prepared",
						channel: state.asset.channel,
						summary: asset.summary,
						timestamp: asset.preparedAt,
					}),
				},
			}));
		},
		applyAssetError(request: AssetLookupRequestDto, errorMessage: string): void {
			update((state) => ({
				...state,
				asset: {
					...state.asset,
					status: "error",
					activeRequest: request,
					errorMessage,
					history: appendAssetActivity(state.asset.history, {
						requestId: request.requestId,
						assetId: request.assetId,
						priority: request.priority,
						status: "failed",
						channel: state.asset.channel,
						summary: errorMessage,
						timestamp: new Date().toISOString(),
					}),
				},
			}));
		},
		useRuntimeResidencyDestination(): void {
			update((state) => {
				const residency = state.host.boundarySnapshot?.runtimeBatch.residency;

				if (!residency) {
					return state;
				}

				return reconcileModeState({
					...state,
					browserMode: selectRuntimeResidencyDestination(
						state.browserMode,
						residency,
					),
				});
			});
		},
	};
}

export const frontendState = createFrontendStateStore();

function applyLoadedSnapshot(
	state: FrontendAppState,
	snapshot: HostBoundarySnapshot,
): FrontendAppState {
	return {
		...state,
		host: {
			boundarySnapshot: snapshot,
			latestRuntimeNotification: state.host.latestRuntimeNotification,
			boundaryStatus:
				snapshot.source === "tauri"
					? "Connected to the Tauri host boundary with a live authoritative runtime feed."
					: "Showing browser-preview fallback data until the Tauri runtime is active.",
		},
		asset: {
			...state.asset,
			channel: snapshot.overview.assetChannel,
		},
		browserMode: seedBrowserDraftFromResidency(
			state.browserMode,
			snapshot.runtimeBatch.residency,
		),
	};
}

function applyRuntimeNotification(
	state: FrontendAppState,
	notification: RuntimeNotificationEnvelopeDto,
): FrontendAppState {
	if (!state.host.boundarySnapshot) {
		return {
			...state,
			host: {
				...state.host,
				latestRuntimeNotification: notification,
			},
		};
	}

	const mergedSnapshot = mergeHostBoundarySnapshot(
		state.host.boundarySnapshot,
		notification,
	);

	return {
		...state,
		host: {
			...state.host,
			boundarySnapshot: mergedSnapshot,
			latestRuntimeNotification: notification,
		},
		browserMode: seedBrowserDraftFromResidency(
			state.browserMode,
			mergedSnapshot.runtimeBatch.residency,
		),
	};
}

function reconcileModeState(state: FrontendAppState): FrontendAppState {
	return {
		...state,
		mode: deriveModeState(
			state.host.boundarySnapshot?.lifecycleState ?? null,
			state.browserMode,
		),
	};
}

function createModeState(
	activeMode: AppModeId,
	activePageId: string,
	routingReason: string,
): ModeState {
	const activeModeSummary =
		availableModes.find((mode) => mode.id === activeMode)?.summary ??
		"Unknown mode summary.";
	const activeModeLabel =
		availableModes.find((mode) => mode.id === activeMode)?.label ??
		"Unknown Mode";

	return {
		activeMode,
		activeModeLabel,
		activeModeSummary,
		activePageId,
		routingReason,
	};
}

function appendAssetActivity(
	history: AssetActivityRecord[],
	entry: AssetActivityRecord,
): AssetActivityRecord[] {
	return [...history, entry].slice(-MAX_ASSET_ACTIVITY);
}
