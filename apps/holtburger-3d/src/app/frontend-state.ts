import { writable } from "svelte/store";

import { availableModes, type AppModeId } from "./modes";
import {
	createBrowserModeState,
	previewBrowserLocation,
	selectBrowserLandblockDestination,
	seedBrowserDraftFromResidency,
	selectRuntimeResidencyDestination,
	updateLandblockCoverageRadius,
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

interface HostConnectionState {
	boundarySnapshot: HostBoundarySnapshot | null;
	latestRuntimeNotification: RuntimeNotificationEnvelopeDto | null;
	boundaryStatus: string;
}

export interface ModeState {
	activeMode: AppModeId;
	activeModeLabel: string;
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

function createInitialFrontendState(): FrontendAppState {
	return reconcileModeState({
		host: {
			boundarySnapshot: null,
			latestRuntimeNotification: null,
			boundaryStatus: DEFAULT_BOUNDARY_STATUS,
		},
		asset: createInitialAssetChannelState(),
		browserMode: createBrowserModeState(),
		mode: createModeState(
			"client",
			"world-viewer",
			"The app runs as a Tauri-backed world viewer; plain browser preview is intentionally unsupported.",
		),
	});
}

function mergeHostBoundarySnapshot(
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
	return createModeState(
		"client",
		browserMode.destination ? browserMode.page : "world-viewer",
		lifecycleState?.phase === "ready" &&
			lifecycleState.sessionState === "connected"
			? "The host lifecycle reports a ready connected client session, so the world viewer is live."
			: "The app stays in one world-viewer mode; navigation overlays can change focus without becoming a separate app mode.",
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
		updateLandblockCoverageRadius(landblockCoverageRadius: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateLandblockCoverageRadius(
						state.browserMode,
						landblockCoverageRadius,
					),
				}),
			);
		},
		selectBrowserLandblockDestination(landblockId: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: selectBrowserLandblockDestination(
						state.browserMode,
						landblockId,
					),
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
					preparedByAssetId: {
						...state.asset.preparedByAssetId,
						[asset.request.assetId]: asset,
					},
					lastResponse: asset.response,
					errorMessage: null,
					history: appendAssetActivity(state.asset.history, {
						requestId: asset.request.requestId,
						assetId: asset.request.assetId,
						priority: asset.request.priority,
						status: "prepared",
						channel: state.asset.channel,
						timestamp: asset.preparedAt,
					}),
				},
			}));
		},
		applyAssetError(
			request: AssetLookupRequestDto,
			errorMessage: string,
		): void {
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
					: "Tauri runtime is unavailable. Start the app with npm run tauri:dev.",
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
	const activeModeLabel =
		availableModes.find((mode) => mode.id === activeMode)?.label ??
		"Unknown Mode";

	return {
		activeMode,
		activeModeLabel,
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
