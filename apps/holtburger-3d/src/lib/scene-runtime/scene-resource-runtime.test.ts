import { describe, expect, it } from "vitest";

import { PreparedAssetStore } from "../assets/prepared-asset-store";
import { MutableStaticLandblockProductSource } from "../world-display/static-landblock-product-source";
import type { SceneResourceInterest } from "./scene-resource-interest";
import {
	createSceneResourceRuntime,
	type ClientAssetRuntime,
	type LandblockProductRuntime,
} from "./scene-resource-runtime";

describe("scene resource runtime", () => {
	it("syncs scene interest through asset and product runtimes", () => {
		const assetRuntime = new MockClientAssetRuntime();
		const productRuntime = new MockLandblockProductRuntime();
		const runtime = createSceneResourceRuntime({
			assets: assetRuntime,
			landblockProducts: productRuntime,
		});
		const sceneInterest = createTestSceneInterest();

		runtime.syncSceneInterest(sceneInterest);

		expect(assetRuntime.syncedInterests).toEqual([sceneInterest]);
		expect(productRuntime.syncedInterests).toEqual([sceneInterest]);
	});

	it("disposes product runtime before asset runtime and ignores later syncs", () => {
		const disposalOrder: string[] = [];
		const assetRuntime = new MockClientAssetRuntime(disposalOrder);
		const productRuntime = new MockLandblockProductRuntime(disposalOrder);
		const runtime = createSceneResourceRuntime({
			assets: assetRuntime,
			landblockProducts: productRuntime,
		});

		runtime.dispose();
		runtime.syncSceneInterest(createTestSceneInterest());
		runtime.dispose();

		expect(disposalOrder).toEqual(["products", "assets"]);
		expect(assetRuntime.syncedInterests).toEqual([]);
		expect(productRuntime.syncedInterests).toEqual([]);
	});
});

class MockClientAssetRuntime implements ClientAssetRuntime {
	readonly preparedAssetResolver = new PreparedAssetStore().resolver;
	readonly syncedInterests: SceneResourceInterest[] = [];

	constructor(private readonly disposalOrder: string[] = []) {}

	syncSceneInterest(sceneInterest: SceneResourceInterest): void {
		this.syncedInterests.push(sceneInterest);
	}

	dispose(): void {
		this.disposalOrder.push("assets");
	}
}

class MockLandblockProductRuntime implements LandblockProductRuntime {
	readonly productSource = new MutableStaticLandblockProductSource();
	readonly syncedInterests: SceneResourceInterest[] = [];

	constructor(private readonly disposalOrder: string[] = []) {}

	syncSceneInterest(sceneInterest: SceneResourceInterest): void {
		this.syncedInterests.push(sceneInterest);
	}

	subscribeProductEvents(
		listener: Parameters<LandblockProductRuntime["subscribeProductEvents"]>[0],
	) {
		return this.productSource.subscribe(listener);
	}

	dispose(): void {
		this.disposalOrder.push("products");
	}
}

function createTestSceneInterest(): SceneResourceInterest {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
		lod: {
			terrain: 2,
			buildings: 1,
			detail: 1,
			envCells: 1,
		},
	};
}
