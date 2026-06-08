import { describe, expect, it } from "vitest";

import {
	WORLD_RENDER_CATEGORY,
	WORLD_RENDER_DRAW_KIND,
	WORLD_RENDER_PASS_ID,
	type WorldRenderDraw,
	type WorldRenderFrame,
} from "./world-render-frame";
import {
	planWebgl2StaticBundleLayerSubmitOrder,
	planWebgl2TerrainTileSubmitOrder,
	planWebgl2TerrainTileSubmitReadiness,
	planWebgl2TransitionPortalMaskSubmitOrder,
} from "./webgl2-world-submit";
import type {
	Webgl2TerrainTileDrawSliceResource,
	Webgl2TerrainTileResource,
} from "./webgl2/resources/terrain-tile-resources";
import type {
	Webgl2StaticBundleLayerResource,
	Webgl2StaticBundleLayerResourceStore,
} from "./webgl2/resources/static-bundle-layer-resources";
import type { Webgl2TransitionPortalMaskResource } from "./webgl2-world-resources";

describe("webgl2 world submit planning", () => {
	it("plans visible terrain tiles from explicit terrain-tile draws", () => {
		const terrainTilesById = new Map<string, Webgl2TerrainTileResource>([
			["terrain-tile/b", createTerrainTile({ id: "terrain-tile/b" })],
			["terrain-tile/a", createTerrainTile({ id: "terrain-tile/a" })],
		]);

		expect(
			planWebgl2TerrainTileSubmitOrder(
				createFrame([
					createTerrainDraw("terrain-tile/b"),
					createTerrainDraw("terrain-tile/a"),
				]),
				terrainTilesById,
			).map((tile) => tile.id),
		).toEqual(["terrain-tile/a", "terrain-tile/b"]);
	});

	it("fails when a terrain draw references a missing terrain tile resource", () => {
		expect(() =>
			planWebgl2TerrainTileSubmitOrder(
				createFrame([createTerrainDraw("missing")]),
				new Map(),
			),
		).toThrow("missing WebGL2 terrain tile missing");
	});

	it("plans visible static bundle layers without generic compaction candidates", () => {
		const store = createStaticBundleLayerResourceStore([
			createStaticBundleLayerResource({ key: "layer/b" }),
			createStaticBundleLayerResource({ key: "layer/a" }),
		]);

		expect(
			planWebgl2StaticBundleLayerSubmitOrder(
				createFrame([
					createStaticBundleLayerDraw("layer/b"),
					createStaticBundleLayerDraw("layer/a"),
				]),
				store,
			).map((layer) => layer.key),
		).toEqual(["layer/a", "layer/b"]);
	});

	it("plans transition portal masks from dedicated mask resources", () => {
		const masksById = new Map<string, Webgl2TransitionPortalMaskResource>([
			["mask/b", createTransitionPortalMaskResource({ id: "mask/b" })],
			["mask/a", createTransitionPortalMaskResource({ id: "mask/a" })],
		]);

		expect(
			planWebgl2TransitionPortalMaskSubmitOrder(
				createFrame([
					createTransitionPortalMaskDraw("mask/b"),
					createTransitionPortalMaskDraw("mask/a"),
				]),
				masksById,
			).map((mask) => mask.id),
		).toEqual(["mask/a", "mask/b"]);
	});

	it("partitions terrain tiles by one-draw readiness and blocked diagnostics", () => {
		const readyTile = createTerrainTile({
			id: "terrain-tile/ready",
			oneDrawReadiness: {
				status: "ready",
				layerEntryCount: 1,
				texturePageBindingCount: 1,
				colorPageBindingCount: 1,
				maskPageBindingCount: 0,
				detailPageBindingCount: 0,
			},
		});
		const blockedTile = createTerrainTile({
			id: "terrain-tile/blocked",
			oneDrawReadiness: {
				status: "blocked",
				blockers: ["missing terrain color page"],
			},
		});

		const plan = planWebgl2TerrainTileSubmitReadiness([blockedTile, readyTile]);

		expect(plan.oneDrawTiles.map((tile) => tile.id)).toEqual([
			"terrain-tile/ready",
		]);
		expect(plan.blockedTiles).toEqual([
			{
				tile: blockedTile,
				blockers: ["missing terrain color page"],
			},
		]);
	});

	it("routes ready terrain draw slices instead of blocking the parent tile", () => {
		const slice = createTerrainDrawSlice({
			id: "terrain-tile/blocked/slice/0",
			parentTerrainTileId: "terrain-tile/blocked",
			oneDrawReadiness: {
				status: "ready",
				layerEntryCount: 1,
				texturePageBindingCount: 1,
				colorPageBindingCount: 1,
				maskPageBindingCount: 0,
				detailPageBindingCount: 0,
			},
		});
		const tile = createTerrainTile({
			id: "terrain-tile/blocked",
			drawSlices: [slice],
		});

		const plan = planWebgl2TerrainTileSubmitReadiness([tile]);

		expect(plan.oneDrawTiles).toEqual([]);
		expect(plan.oneDrawSlices).toEqual([slice]);
		expect(plan.blockedTiles).toEqual([]);
	});
});

function createFrame(draws: readonly WorldRenderDraw[]): WorldRenderFrame {
	return {
		cameraFrame: {
			position: { x: 0, y: 0, z: 0 },
			target: { x: 0, y: 0, z: -1 },
			up: { x: 0, y: 1, z: 0 },
			fovDegrees: 60,
			aspect: 1,
			near: 0.1,
			far: 1000,
		},
		viewProjectionMatrix: new Float32Array(16),
		passes: [
			{
				id: WORLD_RENDER_PASS_ID.world,
				draws: [...draws],
			},
		],
		metrics: {
			registeredBatchCount: 0,
			keyedBatchCount: 0,
			representedItemKeyCount: 0,
			visibleItemKeyCount: 0,
			candidateBatchCount: 0,
			itemKeyMatchedBatchCount: 0,
			unboundFallbackBatchCount: 0,
			explicitFallbackBatchCount: 0,
			queryFallbackBatchCount: 0,
			fallbackReasonCount: 0,
			fallbackReasonSamples: [],
			candidateCountsByCategory: createZeroCategoryCounts(),
			visibleDrawCountsByCategory: createZeroCategoryCounts(),
			fallbackCountsByCategory: createZeroCategoryCounts(),
			representedItemKeyCountsByCategory: createZeroCategoryCounts(),
		},
	};
}

function createZeroCategoryCounts() {
	return {
		[WORLD_RENDER_CATEGORY.terrain]: 0,
		[WORLD_RENDER_CATEGORY.structuredInterior]: 0,
		[WORLD_RENDER_CATEGORY.static]: 0,
		[WORLD_RENDER_CATEGORY.portalMask]: 0,
		[WORLD_RENDER_CATEGORY.debugOverlay]: 0,
	};
}

function createTerrainDraw(terrainTileId: string): WorldRenderDraw {
	return {
		kind: WORLD_RENDER_DRAW_KIND.terrainTile,
		terrainTileId,
		category: WORLD_RENDER_CATEGORY.terrain,
	};
}

function createStaticBundleLayerDraw(staticBundleLayerId: string): WorldRenderDraw {
	return {
		kind: WORLD_RENDER_DRAW_KIND.staticBundleLayer,
		staticBundleLayerId,
		category: WORLD_RENDER_CATEGORY.static,
	};
}

function createTransitionPortalMaskDraw(
	transitionPortalMaskId: string,
): WorldRenderDraw {
	return {
		kind: WORLD_RENDER_DRAW_KIND.transitionPortalMask,
		transitionPortalMaskId,
		category: WORLD_RENDER_CATEGORY.portalMask,
	};
}

function createTerrainTile({
	id,
	oneDrawReadiness = { status: "blocked", blockers: [] },
	drawSlices = [],
}: {
	id: string;
	oneDrawReadiness?: Webgl2TerrainTileResource["oneDrawReadiness"];
	drawSlices?: readonly Webgl2TerrainTileDrawSliceResource[];
}): Webgl2TerrainTileResource {
	return {
		id,
		oneDrawReadiness,
		drawSlices,
	} as Webgl2TerrainTileResource;
}

function createTerrainDrawSlice({
	id,
	parentTerrainTileId,
	oneDrawReadiness,
}: {
	id: string;
	parentTerrainTileId: string;
	oneDrawReadiness: Webgl2TerrainTileDrawSliceResource["oneDrawReadiness"];
}): Webgl2TerrainTileDrawSliceResource {
	return {
		id,
		parentTerrainTileId,
		oneDrawReadiness,
	} as Webgl2TerrainTileDrawSliceResource;
}

function createStaticBundleLayerResourceStore(
	layers: readonly Webgl2StaticBundleLayerResource[],
): Webgl2StaticBundleLayerResourceStore {
	return {
		productsByKey: new Map(),
		layersByKey: new Map(layers.map((layer) => [layer.key, layer])),
	};
}

function createStaticBundleLayerResource({
	key,
}: {
	key: string;
}): Webgl2StaticBundleLayerResource {
	return {
		key,
	} as Webgl2StaticBundleLayerResource;
}

function createTransitionPortalMaskResource({
	id,
}: {
	id: string;
}): Webgl2TransitionPortalMaskResource {
	return {
		id,
	} as Webgl2TransitionPortalMaskResource;
}
