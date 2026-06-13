import { describe, expect, it } from "vitest";

import { createAssetState } from "./asset-state";
import {
	createBrowserModeState,
	selectBrowserLandblockDestination,
	updateBrowserCameraNearPlane,
	updatePortalPolygonVisibility,
	updateTerrainLodRadius,
	type BrowserModeState,
} from "./browser-mode";
import { createBrowserSceneResourceController } from "./browser-scene-resource-controller";
import type { FrontendAppState } from "./frontend-state";
import type { SceneResourceInterest } from "../lib/scene-runtime/scene-resource-interest";
import type { SceneResourceRuntime } from "../lib/scene-runtime/scene-resource-runtime";
import {
	MutableStaticLandblockProductSource,
	type StaticLandblockProductSource,
} from "../lib/world-display/static-landblock-product-source";

describe("createBrowserSceneResourceController", () => {
	it("syncs runtime only when neutral scene interest changes", () => {
		const store = new FakeFrontendStateStore(createState());
		const runtime = new RecordingSceneResourceRuntime();
		const observedStates: FrontendAppState[] = [];
		const controller = createBrowserSceneResourceController({
			frontendState: store,
			runtime,
			onFrontendState: (state) => observedStates.push(state),
		});

		expect(runtime.sceneInterests).toHaveLength(1);
		expect(observedStates).toHaveLength(1);

		store.updateBrowserMode((browserMode) =>
			updateBrowserCameraNearPlane(
				browserMode,
				browserMode.cameraNearPlane + 0.1,
			),
		);
		store.updateBrowserMode((browserMode) =>
			updatePortalPolygonVisibility(
				browserMode,
				!browserMode.showPortalPolygons,
			),
		);
		store.set({
			...store.current,
			asset: {
				...store.current.asset,
				status: "pending",
			},
		});

		expect(runtime.sceneInterests).toHaveLength(1);
		expect(observedStates).toHaveLength(4);

		store.updateBrowserMode((browserMode) =>
			updateTerrainLodRadius(browserMode, browserMode.terrainLodRadius + 1),
		);
		store.updateBrowserMode((browserMode) =>
			selectBrowserLandblockDestination(browserMode, 0xda56ffff),
		);

		expect(runtime.sceneInterests).toHaveLength(3);

		controller.dispose();
		store.updateBrowserMode((browserMode) =>
			updateTerrainLodRadius(browserMode, browserMode.terrainLodRadius + 1),
		);

		expect(runtime.sceneInterests).toHaveLength(3);
	});

	it("can be disposed repeatedly", () => {
		const store = new FakeFrontendStateStore(createState());
		const runtime = new RecordingSceneResourceRuntime();
		const controller = createBrowserSceneResourceController({
			frontendState: store,
			runtime,
		});

		controller.dispose();
		controller.dispose();

		store.updateBrowserMode((browserMode) =>
			updateTerrainLodRadius(browserMode, browserMode.terrainLodRadius + 1),
		);

		expect(runtime.sceneInterests).toHaveLength(1);
	});
});

class FakeFrontendStateStore {
	private listeners = new Set<(state: FrontendAppState) => void>();
	current: FrontendAppState;

	constructor(initialState: FrontendAppState) {
		this.current = initialState;
	}

	subscribe(listener: (state: FrontendAppState) => void): () => void {
		this.listeners.add(listener);
		listener(this.current);
		return () => {
			this.listeners.delete(listener);
		};
	}

	set(nextState: FrontendAppState): void {
		this.current = nextState;
		for (const listener of this.listeners) {
			listener(nextState);
		}
	}

	updateBrowserMode(
		update: (browserMode: BrowserModeState) => BrowserModeState,
	): void {
		this.set({
			...this.current,
			browserMode: update(this.current.browserMode),
		});
	}
}

class RecordingSceneResourceRuntime implements SceneResourceRuntime {
	readonly sceneInterests: SceneResourceInterest[] = [];
	readonly landblockProducts = {
		productSource:
			new MutableStaticLandblockProductSource() as StaticLandblockProductSource,
		syncSceneInterest: () => {},
		dispose: () => {},
	};
	readonly assets = {
		syncSceneInterest: () => {},
		dispose: () => {},
	};

	syncSceneInterest(sceneInterest: SceneResourceInterest): void {
		this.sceneInterests.push(sceneInterest);
	}

	dispose(): void {}
}

function createState(): FrontendAppState {
	return {
		asset: createAssetState(),
		browserMode: createBrowserModeState(),
	};
}
