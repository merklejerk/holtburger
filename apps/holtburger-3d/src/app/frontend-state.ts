import { writable } from "svelte/store";

import {
	applyBrowserCameraResidencyDestination,
	createBrowserModeState,
	previewBrowserLocation,
	selectBrowserLandblockDestination,
	updateBuildingLodRadius,
	updateBrowserDraft,
	updateBrowserDetailTexturesEnabled,
	updateBrowserRenderStyle,
	updateBrowserTextureFilteringMode,
	updateDetailLodRadius,
	updateEnvCellLodRadius,
	updateCellIndicatorVisibility,
	updateLandblockInputMode,
	updateNavigationFocusMode,
	updatePortalPolygonVisibility,
	updatePortalTargetHighlighting,
	updateTerrainLodRadius,
	updateTransitionPortalMaxDepth,
	type BrowserCameraResidencyDestinationInput,
	type BrowserLandblockInputMode,
	type BrowserModeState,
	type BrowserNavigationFocusMode,
	type BrowserRenderStyle,
	type BrowserTextureFilteringMode,
} from "./browser-mode";
import {
	applyAssetCachePrune as applyAssetCachePruneToState,
	applyAssetError as applyAssetErrorToState,
	applyPreparedAssets as applyPreparedAssetsToState,
	createAssetState,
	markAssetsPending as markAssetsPendingInState,
} from "./asset-state";
import type { PreparedAssetCachePrunePlan } from "../lib/assets/asset-cache-policy";
import type {
	AssetChannelState,
	PreparedAssetRecord,
} from "../lib/assets/types";
import type { AssetLookupRequestDto } from "../lib/host/contracts";

export interface FrontendAppState {
	asset: AssetChannelState;
	browserMode: BrowserModeState;
}

function createInitialFrontendState(): FrontendAppState {
	return {
		asset: createAssetState(),
		browserMode: createBrowserModeState(),
	};
}

function createFrontendStateStore() {
	const { subscribe, update } = writable<FrontendAppState>(
		createInitialFrontendState(),
	);

	return {
		subscribe,
		updateBrowserDraft(draftInput: string): void {
			update((state) => ({
				...state,
				browserMode: updateBrowserDraft(state.browserMode, draftInput),
			}));
		},
		previewBrowserLocation(): void {
			update((state) => ({
				...state,
				browserMode: previewBrowserLocation(state.browserMode),
			}));
		},
		updateTerrainLodRadius(terrainLodRadius: number): void {
			update((state) => ({
				...state,
				browserMode: updateTerrainLodRadius(
					state.browserMode,
					terrainLodRadius,
				),
			}));
		},
		updateBuildingLodRadius(buildingLodRadius: number): void {
			update((state) => ({
				...state,
				browserMode: updateBuildingLodRadius(
					state.browserMode,
					buildingLodRadius,
				),
			}));
		},
		updateDetailLodRadius(detailLodRadius: number): void {
			update((state) => ({
				...state,
				browserMode: updateDetailLodRadius(state.browserMode, detailLodRadius),
			}));
		},
		updateEnvCellLodRadius(envCellLodRadius: number): void {
			update((state) => ({
				...state,
				browserMode: updateEnvCellLodRadius(
					state.browserMode,
					envCellLodRadius,
				),
			}));
		},
		updateTransitionPortalMaxDepth(maxDepth: number): void {
			update((state) => ({
				...state,
				browserMode: updateTransitionPortalMaxDepth(
					state.browserMode,
					maxDepth,
				),
			}));
		},
		updateLandblockInputMode(
			landblockInputMode: BrowserLandblockInputMode,
		): void {
			update((state) => ({
				...state,
				browserMode: updateLandblockInputMode(
					state.browserMode,
					landblockInputMode,
				),
			}));
		},
		updateNavigationFocusMode(
			navigationFocusMode: BrowserNavigationFocusMode,
		): void {
			update((state) => ({
				...state,
				browserMode: updateNavigationFocusMode(
					state.browserMode,
					navigationFocusMode,
				),
			}));
		},
		applyBrowserCameraResidencyDestination(
			residency: BrowserCameraResidencyDestinationInput,
		): void {
			update((state) => ({
				...state,
				browserMode: applyBrowserCameraResidencyDestination(
					state.browserMode,
					residency,
				),
			}));
		},
		updatePortalPolygonVisibility(showPortalPolygons: boolean): void {
			update((state) => ({
				...state,
				browserMode: updatePortalPolygonVisibility(
					state.browserMode,
					showPortalPolygons,
				),
			}));
		},
		updateCellIndicatorVisibility(showCellIndicators: boolean): void {
			update((state) => ({
				...state,
				browserMode: updateCellIndicatorVisibility(
					state.browserMode,
					showCellIndicators,
				),
			}));
		},
		updatePortalTargetHighlighting(highlightPortalTargets: boolean): void {
			update((state) => ({
				...state,
				browserMode: updatePortalTargetHighlighting(
					state.browserMode,
					highlightPortalTargets,
				),
			}));
		},
		updateBrowserRenderStyle(renderStyle: BrowserRenderStyle): void {
			update((state) => ({
				...state,
				browserMode: updateBrowserRenderStyle(state.browserMode, renderStyle),
			}));
		},
		updateBrowserTextureFilteringMode(
			textureFilteringMode: BrowserTextureFilteringMode,
		): void {
			update((state) => ({
				...state,
				browserMode: updateBrowserTextureFilteringMode(
					state.browserMode,
					textureFilteringMode,
				),
			}));
		},
		updateBrowserDetailTexturesEnabled(detailTexturesEnabled: boolean): void {
			update((state) => ({
				...state,
				browserMode: updateBrowserDetailTexturesEnabled(
					state.browserMode,
					detailTexturesEnabled,
				),
			}));
		},
		selectBrowserLandblockDestination(landblockId: number): void {
			update((state) => ({
				...state,
				browserMode: selectBrowserLandblockDestination(
					state.browserMode,
					landblockId,
				),
			}));
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
		applyAssetCachePrune(prunePlan: PreparedAssetCachePrunePlan): void {
			update((state) => ({
				...state,
				asset: applyAssetCachePruneToState(state.asset, prunePlan),
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
	};
}

export const frontendState = createFrontendStateStore();
