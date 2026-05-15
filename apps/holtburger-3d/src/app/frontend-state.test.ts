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
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
		...overrides,
	};
}

function createViewModelFeed(
	overrides: Partial<FrontendStateFeedDto> = {},
): FrontendStateFeedDto {
	return {
		selectedEntityId: null,
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
			activeModeHint: "client",
			sessionState: "disconnected",
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
			indoorContractBacklog: {
				runtimeFieldIds: [
					"focus-env-cell-id",
					"visible-cell-ids",
					"seen-outside",
					"environment-id",
					"cell-structure-id",
				],
				assetFamilyIds: ["indoor-env-cell", "environment"],
			},
		},
	};
}

describe("frontend state store", () => {
	it("seeds the navigation draft from the runtime residency snapshot", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createSnapshot());

		expect(get(store).browserMode.draftInput).toBe("33.50S, 72.80E, 0.0Z");
		expect(get(store).browserMode.destination?.label).toBe(
			"33.50S, 72.80E, 0.0Z",
		);
		expect(get(store).browserMode.landblockCoverageRadius).toBe(1);
		expect(get(store).mode.activeMode).toBe("client");
		expect(get(store).mode.activePageId).toBe("destination-preview");
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
					focusEntityId: null,
					focusLandblockId: 0x0102001b,
					focusCellId: 27,
					focusEnvCellId: 0x0102010b,
					visibleCellIds: [0x0102010c, 0x0102010d],
					seenOutside: false,
					environmentId: 0x0d000001,
					cellStructureId: 1,
					focusLocationLabel: "100.41S, 101.52W, 0.0Z",
					indoors: true,
					trackedBodyCount: 0,
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
			assetId: "terrain/0102ffff",
			priority: "bootstrap",
		});
		store.applyPreparedAsset({
			request: {
				requestId: "bootstrap-asset",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			response: {
				requestId: "bootstrap-asset",
				assetId: "terrain/0102ffff",
				payloadKind: "json",
				payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
			},
			payload: {
				kind: "terrain-landblock",
				sourceAssetKind: "cell-landblock",
				residencyKind: "outdoor-landblock",
				provenance: {
					source: "unknown",
					sourceAssetKind: "cell-landblock",
					errorCode: null,
					detail: null,
				},
				debugPresentation: {
					primitive: "terrain-landblock-mesh",
					paletteKey: "terrain-0102ffff",
				},
				terrainMesh: {
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 24,
				},
			},
			preparedAt: "2026-04-26T00:00:00.000Z",
		});

		expect(get(store).asset.status).toBe("ready");
		expect(get(store).asset.preparedAsset?.request.assetId).toBe(
			"terrain/0102ffff",
		);
		expect(
			get(store).asset.preparedByAssetId["terrain/0102ffff"]?.request.assetId,
		).toBe("terrain/0102ffff");
		expect(get(store).asset.preparedByPriority.bootstrap?.request.assetId).toBe(
			"terrain/0102ffff",
		);
		expect(get(store).asset.history.map((entry) => entry.status)).toEqual([
			"requested",
			"prepared",
		]);
	});

	it("can batch asset pending and prepared updates into one state transition", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createSnapshot());
		store.markAssetsPending([
			{
				requestId: "bootstrap-terrain-a",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			{
				requestId: "bootstrap-terrain-b",
				assetId: "terrain/0103ffff",
				priority: "bootstrap",
			},
		]);
		store.applyPreparedAssets([
			createPreparedTerrainAsset("bootstrap-terrain-a", "terrain/0102ffff"),
			createPreparedTerrainAsset("bootstrap-terrain-b", "terrain/0103ffff"),
		]);

		expect(get(store).asset.status).toBe("ready");
		expect(get(store).asset.activeRequest?.assetId).toBe("terrain/0103ffff");
		expect(
			get(store).asset.preparedByAssetId["terrain/0102ffff"],
		).toBeDefined();
		expect(
			get(store).asset.preparedByAssetId["terrain/0103ffff"],
		).toBeDefined();
		expect(get(store).asset.history.map((entry) => entry.status)).toEqual([
			"requested",
			"requested",
			"prepared",
			"prepared",
		]);
	});

	it("keeps the app in world-viewer mode even when a destination override is active", () => {
		const browserModeStore = createFrontendStateStore();

		browserModeStore.loadSnapshot({
			...createSnapshot(),
			lifecycleState: {
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
			},
		});
		browserModeStore.useRuntimeResidencyDestination();

		expect(get(browserModeStore).mode.activeMode).toBe("client");
		expect(get(browserModeStore).mode.activePageId).toBe("destination-preview");
	});

	it("can select browser focus from an exact landblock id", () => {
		const store = createFrontendStateStore();

		store.selectBrowserLandblockDestination(0xda550123);

		expect(get(store).browserMode.destination?.source).toBe("landblock-pick");
		expect(get(store).browserMode.destination?.landblockId).toBe(0xda55ffff);
		expect(get(store).browserMode.destination?.label).toContain("0xda55ffff");
		expect(get(store).mode.activePageId).toBe("destination-preview");
	});

	it("keeps the world-viewer page active when lifecycle facts are ready and connected", () => {
		const mode = deriveModeState(
			{
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
			},
			{
				draftInput: "",
				validationMessage: null,
				destination: null,
				landblockCoverageRadius: 1,
				structuredInteriorMaxEnvCells: 1024,
				structuredInteriorMaxVisibleCellDepth: 16,
				page: "location-entry",
			},
		);

		expect(mode.activeMode).toBe("client");
		expect(mode.activePageId).toBe("world-viewer");
	});
});

function createPreparedTerrainAsset(requestId: string, assetId: string) {
	return {
		request: {
			requestId,
			assetId,
			priority: "bootstrap" as const,
		},
		response: {
			requestId,
			assetId,
			payloadKind: "json" as const,
			payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
		},
		payload: {
			kind: "terrain-landblock" as const,
			sourceAssetKind: "cell-landblock" as const,
			residencyKind: "outdoor-landblock" as const,
			provenance: {
				source: "unknown" as const,
				sourceAssetKind: "cell-landblock" as const,
				errorCode: null,
				detail: null,
			},
			debugPresentation: {
				primitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0102ffff",
			},
			terrainMesh: {
				landblockId: 0x0102ffff,
				gridSize: 9,
				tileSize: 24,
				vertices: [],
				triangles: [],
				minHeight: 0,
				maxHeight: 24,
			},
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}
