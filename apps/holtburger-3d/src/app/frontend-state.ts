import { writable } from "svelte/store";

import {
	createBrowserModeState,
	previewBrowserLocation,
	selectBrowserLandblockDestination,
	seedBrowserDraftFromResidency,
	selectRuntimeResidencyDestination,
	updateBuildingLodRadius,
	updateBrowserDraft,
	updateDetailLodRadius,
	updateStructuredInteriorMaxEnvCells,
	updateStructuredInteriorMaxVisibleCellDepth,
	updateTerrainLodRadius,
	type BrowserModeState,
} from "./browser-mode";
import {
	applyAssetError as applyAssetErrorToState,
	applyPreparedAssets as applyPreparedAssetsToState,
	createAssetState,
	markAssetsPending as markAssetsPendingInState,
	updateAssetChannel,
} from "./asset-state";
import type {
	AssetChannelState,
	PreparedAssetRecord,
} from "../lib/assets/types";
import type {
	AssetLookupRequestDto,
	HostBoundarySnapshot,
	RuntimeNotificationEnvelopeDto,
} from "../lib/host/contracts";
import {
	applyLoadedSnapshot as applyLoadedHostSnapshot,
	applyRuntimeNotification as applyHostRuntimeNotification,
	createHostConnectionState,
	type HostConnectionState,
} from "./host-state";
import {
	createInitialModeState,
	deriveModeState,
	type ModeState,
} from "./mode-state";

export interface FrontendAppState {
	host: HostConnectionState;
	asset: AssetChannelState;
	browserMode: BrowserModeState;
	mode: ModeState;
}

function createInitialFrontendState(): FrontendAppState {
	return reconcileModeState({
		host: createHostConnectionState(),
		asset: createAssetState(),
		browserMode: createBrowserModeState(),
		mode: createInitialModeState(),
	});
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
		updateTerrainLodRadius(terrainLodRadius: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateTerrainLodRadius(
						state.browserMode,
						terrainLodRadius,
					),
				}),
			);
		},
		updateBuildingLodRadius(buildingLodRadius: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateBuildingLodRadius(
						state.browserMode,
						buildingLodRadius,
					),
				}),
			);
		},
		updateDetailLodRadius(detailLodRadius: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateDetailLodRadius(
						state.browserMode,
						detailLodRadius,
					),
				}),
			);
		},
		updateStructuredInteriorMaxEnvCells(maxEnvCells: number): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateStructuredInteriorMaxEnvCells(
						state.browserMode,
						maxEnvCells,
					),
				}),
			);
		},
		updateStructuredInteriorMaxVisibleCellDepth(
			maxVisibleCellDepth: number,
		): void {
			update((state) =>
				reconcileModeState({
					...state,
					browserMode: updateStructuredInteriorMaxVisibleCellDepth(
						state.browserMode,
						maxVisibleCellDepth,
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
			this.markAssetsPending([request]);
		},
		markAssetsPending(requests: AssetLookupRequestDto[]): void {
			if (requests.length === 0) {
				return;
			}

			update((state) => ({
				...state,
				asset: markAssetsPendingInState(state.asset, requests),
			}));
		},
		applyPreparedAsset(asset: PreparedAssetRecord): void {
			this.applyPreparedAssets([asset]);
		},
		applyPreparedAssets(assets: PreparedAssetRecord[]): void {
			if (assets.length === 0) {
				return;
			}

			update((state) => ({
				...state,
				asset: applyPreparedAssetsToState(state.asset, assets),
			}));
		},
		applyAssetError(
			request: AssetLookupRequestDto,
			errorMessage: string,
		): void {
			update((state) => ({
				...state,
				asset: applyAssetErrorToState(state.asset, request, errorMessage),
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
		host: applyLoadedHostSnapshot(state.host, snapshot),
		asset: updateAssetChannel(state.asset, snapshot.overview.assetChannel),
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
	const host = applyHostRuntimeNotification(state.host, notification);

	return {
		...state,
		host,
		browserMode: host.boundarySnapshot
			? seedBrowserDraftFromResidency(
					state.browserMode,
					host.boundarySnapshot.runtimeBatch.residency,
				)
			: state.browserMode,
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
