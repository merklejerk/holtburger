import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import { createFrontendStateStore } from "./frontend-state";
import type { RuntimeNotificationEnvelopeDto } from "../lib/host/contracts";
import {
	createHostSnapshot,
	createPreparedTerrainAsset,
	createRuntimeBatch,
	createViewModelFeed,
} from "./test-fixtures";

describe("frontend state store", () => {
	it("seeds the navigation draft from the runtime residency snapshot", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createHostSnapshot());

		expect(get(store).browserMode.draftInput).toBe("33.50S, 72.80E, 0.0Z");
		expect(get(store).browserMode.destination?.label).toBe(
			"33.50S, 72.80E, 0.0Z",
		);
		expect(get(store).browserMode.terrainLodRadius).toBe(2);
		expect(get(store).browserMode.buildingLodRadius).toBe(1);
		expect(get(store).browserMode.detailLodRadius).toBe(1);
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

		store.loadSnapshot(createHostSnapshot());
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

	it("does not refill an intentionally cleared browser draft from runtime residency", () => {
		const store = createFrontendStateStore();
		const notification: RuntimeNotificationEnvelopeDto = {
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState: null,
			runtimeBatch: createRuntimeBatch({
				tick: 3,
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x0102001b,
					focusCellId: 27,
					focusEnvCellId: null,
					visibleCellIds: [],
					seenOutside: null,
					environmentId: null,
					cellStructureId: null,
					focusLocationLabel: "100.05S, 101.02W, 2.0Z",
					indoors: false,
					trackedBodyCount: 0,
				},
			}),
			viewModelFeed: createViewModelFeed(),
		};

		store.loadSnapshot(createHostSnapshot());
		store.updateBrowserDraft("");
		store.applyRuntimeNotification(notification);

		expect(get(store).browserMode.draftInput).toBe("");
		expect(get(store).browserMode.draftInputEditedByUser).toBe(true);
	});

	it("tracks asset preparation state separately from the host boundary snapshot", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createHostSnapshot());
		store.markAssetPending({
			requestId: "bootstrap-asset",
			assetId: "landblock-pack/0102ffff",
			priority: "bootstrap",
		});
		store.applyPreparedAsset(
			createPreparedTerrainAsset("bootstrap-asset", "landblock-pack/0102ffff"),
		);

		expect(get(store).asset.status).toBe("ready");
		expect(get(store).asset.preparedAsset?.request.assetId).toBe(
			"landblock-pack/0102ffff",
		);
		expect(
			get(store).asset.preparedByAssetId["landblock-pack/0102ffff"]?.request.assetId,
		).toBe("landblock-pack/0102ffff");
		expect(get(store).asset.preparedByPriority.bootstrap?.request.assetId).toBe(
			"landblock-pack/0102ffff",
		);
		expect(get(store).asset.history.map((entry) => entry.status)).toEqual([
			"requested",
			"prepared",
		]);
	});

	it("can batch asset pending and prepared updates into one state transition", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot(createHostSnapshot());
		store.markAssetsPending([
			{
				requestId: "bootstrap-terrain-a",
				assetId: "landblock-pack/0102ffff",
				priority: "bootstrap",
			},
			{
				requestId: "bootstrap-terrain-b",
				assetId: "landblock-pack/0103ffff",
				priority: "bootstrap",
			},
		]);
		store.applyPreparedAssets([
			createPreparedTerrainAsset("bootstrap-terrain-a", "landblock-pack/0102ffff"),
			createPreparedTerrainAsset("bootstrap-terrain-b", "landblock-pack/0103ffff"),
		]);

		expect(get(store).asset.status).toBe("ready");
		expect(get(store).asset.activeRequest?.assetId).toBe("landblock-pack/0103ffff");
		expect(
			get(store).asset.preparedByAssetId["landblock-pack/0102ffff"],
		).toBeDefined();
		expect(
			get(store).asset.preparedByAssetId["landblock-pack/0103ffff"],
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
			...createHostSnapshot(),
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

	it("keeps mode derivation wired through the composed store", () => {
		const store = createFrontendStateStore();

		store.loadSnapshot({
			...createHostSnapshot(),
			lifecycleState: {
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
			},
		});
		store.updateBrowserDraft("");

		expect(get(store).mode.activeMode).toBe("client");
		expect(get(store).mode.activePageId).toBe("destination-preview");
	});
});
