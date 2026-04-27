import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import { createFrontendStateStore, deriveModeState } from "./frontend-state";
import type {
	FrontendStateFeedDto,
	HostBoundarySnapshot,
	RuntimeBatchDto,
	RuntimeNotificationEnvelopeDto,
} from "../lib/host/contracts";

function createRuntimeBatch(
	overrides: Partial<RuntimeBatchDto> = {},
): RuntimeBatchDto {
	return {
		tick: 1,
		entities: [
			{
				entityId: 0x01020304,
				label: "Browser Scout",
				position: { x: 12, y: -4.5, z: 1 },
				headingRadians: 0,
				visualAssetId: "gfx/02000001",
				landblockId: 0x01020003,
				cellId: 3,
				locationLabel: "100.40S, 101.55W, 1.0Z",
				isLocalPlayer: true,
			},
		],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
		...overrides,
	};
}

function createViewModelFeed(
	overrides: Partial<FrontendStateFeedDto> = {},
): FrontendStateFeedDto {
	return {
		selectedEntityId: 0x01020304,
		interactionMode: "inspect",
		busyState: "idle",
		...overrides,
	};
}

function createSnapshot(): HostBoundarySnapshot {
	return {
		source: "tauri",
		lifecycleState: {
			phase: "ready",
			activeModeHint: "browser",
			sessionState: "disconnected",
			summary: "Browser mode is available.",
		},
		runtimeBatch: createRuntimeBatch(),
		viewModelFeed: createViewModelFeed(),
		overview: {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			notes: [],
		},
	};
}

describe("frontend state store", () => {
	it("seeds the browser draft from the runtime residency snapshot", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createSnapshot());

		expect(get(store).browserMode.draftInput).toBe("100.40S, 101.55W, 1.0Z");
		expect(get(store).mode.activeMode).toBe("browser");
		expect(get(store).asset.channel).toBe("asset");
	});

	it("merges runtime notifications inside the store boundary", () => {
		const store = createFrontendStateStore();
		const notification: RuntimeNotificationEnvelopeDto = {
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState: null,
			runtimeBatch: createRuntimeBatch({
				tick: 2,
				residency: {
					focusEntityId: 0x01020304,
					focusLandblockId: 0x0102001b,
					focusCellId: 27,
					focusLocationLabel: "100.41S, 101.52W, 0.0Z",
					indoors: true,
					trackedBodyCount: 2,
				},
			}),
			viewModelFeed: createViewModelFeed({ busyState: "loading" }),
		};

		store.loadSnapshot(createSnapshot());
		store.applyRuntimeNotification(notification);

		expect(get(store).host.boundarySnapshot?.runtimeBatch.tick).toBe(2);
		expect(
			get(store).host.boundarySnapshot?.runtimeBatch.residency.focusLandblockId,
		).toBe(0x0102001b);
		expect(get(store).host.boundarySnapshot?.viewModelFeed.busyState).toBe(
			"loading",
		);
		expect(get(store).host.latestRuntimeNotification?.topic).toBe(
			"runtime.batch",
		);
	});

	it("tracks asset preparation state separately from the host boundary snapshot", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createSnapshot());
		store.markAssetPending({
			requestId: "bootstrap-asset",
			assetId: "gfx/02000001",
			priority: "bootstrap",
		});
		store.applyPreparedAsset({
			request: {
				requestId: "bootstrap-asset",
				assetId: "gfx/02000001",
				priority: "bootstrap",
			},
			response: {
				requestId: "bootstrap-asset",
				assetId: "gfx/02000001",
				payloadKind: "json",
				payload: { kind: "appearance-manifest" },
			},
			residencyKind: "outdoor-landblock",
			debugPrimitive: "survey-billboard",
			paletteKey: "bronze-scout",
			summary: "Prepared gfx/02000001 as survey-billboard for outdoor-landblock.",
			notes: [],
			preparedAt: "2026-04-26T00:00:00.000Z",
		});

		expect(get(store).asset.status).toBe("ready");
		expect(get(store).asset.preparedAsset?.request.assetId).toBe(
			"gfx/02000001",
		);
		expect(get(store).asset.preparedByPriority.bootstrap?.request.assetId).toBe(
			"gfx/02000001",
		);
		expect(get(store).asset.history.map((entry) => entry.status)).toEqual([
			"requested",
			"prepared",
		]);
	});

	it("prefers an explicit browser destination over a connected client-mode hint", () => {
		const browserModeStore = createFrontendStateStore();

		browserModeStore.loadSnapshot({
			...createSnapshot(),
			lifecycleState: {
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
				summary: "A client session is available.",
			},
		});
		browserModeStore.useRuntimeResidencyDestination();

		expect(get(browserModeStore).mode.activeMode).toBe("browser");
		expect(get(browserModeStore).mode.activePageId).toBe("destination-preview");
	});

	it("routes to client mode when lifecycle facts are ready and connected", () => {
		const mode = deriveModeState(
			{
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
				summary: "Connected.",
			},
			{
				draftInput: "",
				validationMessage: null,
				destination: null,
				page: "location-entry",
			},
		);

		expect(mode.activeMode).toBe("client");
		expect(mode.activePageId).toBe("session-live");
	});
});
