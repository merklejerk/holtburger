import { describe, expect, it } from "vitest";

import type { SceneCameraFrame } from "./camera";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import {
	buildRenderFrustumFromProjectionMatrix,
	buildWorldRenderFrame as buildWorldRenderFrameImpl,
	WORLD_RENDER_CANDIDATE_KIND,
	WORLD_RENDER_CATEGORY,
	WORLD_RENDER_DRAW_KIND,
	WORLD_RENDER_PASS_ID,
	type WorldRenderCandidate,
} from "./world-render-frame";
import { buildSceneCameraViewProjectionMatrix } from "./render-math";
import type { TerrainSceneModel } from "./terrain-scene";
import { createEmptyStaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import { createEmptyStaticRenderableSceneModel } from "./static-renderables";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";

describe("buildWorldRenderFrame", () => {
	it("culls keyed batches when no render BVH item is visible", () => {
		const frame = buildWorldRenderFrameImpl({
			assetReadModel: emptyAssetReadModel(),
			candidates: [
				createBatch({
					id: "terrain/culled",
					kind: WORLD_RENDER_CANDIDATE_KIND.terrainTile,
					itemKeys: ["terrain:landblock:0203ffff:quad:7"],
				}),
			],
			cameraFrame: createCameraFrame(),
			renderChunkTransforms: [],
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			staticLandblockRenderProducts:
				createEmptyStaticLandblockRenderProductSet(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			terrainScene: createTerrainScene(),
		});

		expect(frame.passes).toEqual([{ id: WORLD_RENDER_PASS_ID.world, draws: [] }]);
		expect(frame.metrics.registeredBatchCount).toBe(1);
		expect(frame.metrics.keyedBatchCount).toBe(1);
		expect(frame.metrics.candidateBatchCount).toBe(0);
	});

	it("keeps explicit unkeyed fallback resources visible and sorts draw categories", () => {
		const frame = buildWorldRenderFrameImpl({
			assetReadModel: emptyAssetReadModel(),
			candidates: [
				createBatch({
					id: "static-bundle-layer/world|landblock/0203ffff|object-b",
					kind: WORLD_RENDER_CANDIDATE_KIND.staticBundleLayer,
					fallbackReason: "test static fallback",
				}),
				createBatch({
					id: "terrain/fallback",
					kind: WORLD_RENDER_CANDIDATE_KIND.terrainTile,
					fallbackReason: "test terrain fallback",
				}),
			],
			cameraFrame: createCameraFrame(),
			renderChunkTransforms: [],
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			staticLandblockRenderProducts:
				createEmptyStaticLandblockRenderProductSet(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			terrainScene: createTerrainScene(),
		});

		expect(frame.passes[0]?.draws).toEqual([
			{
				kind: WORLD_RENDER_DRAW_KIND.terrainTile,
				terrainTileId: "terrain/fallback",
				category: WORLD_RENDER_CATEGORY.terrain,
			},
			{
				kind: WORLD_RENDER_DRAW_KIND.staticBundleLayer,
				staticBundleLayerId:
					"static-bundle-layer/world|landblock/0203ffff|object-b",
				category: WORLD_RENDER_CATEGORY.static,
			},
		]);
		expect(frame.metrics.candidateBatchCount).toBe(2);
		expect(frame.metrics.unboundFallbackBatchCount).toBe(2);
		expect(frame.metrics.visibleDrawCountsByCategory.terrain).toBe(1);
		expect(frame.metrics.visibleDrawCountsByCategory.static).toBe(1);
	});

	it("keeps terrain tile resources visible", () => {
		const frame = buildFrameWithFallbackCandidates([
			createBatch({
				id: "terrain-tile/terrain/0203ffff",
				kind: WORLD_RENDER_CANDIDATE_KIND.terrainTile,
				fallbackReason: "test terrain tile fallback",
			}),
		]);

		expect(frame.passes[0]?.draws).toEqual([
			{
				kind: WORLD_RENDER_DRAW_KIND.terrainTile,
				terrainTileId: "terrain-tile/terrain/0203ffff",
				category: WORLD_RENDER_CATEGORY.terrain,
			},
		]);
		expect(frame.metrics.visibleDrawCountsByCategory.terrain).toBe(1);
		expect(frame.metrics.candidateCountsByCategory.terrain).toBe(1);
	});
});

describe("buildRenderFrustumFromProjectionMatrix", () => {
	it("normalizes extracted planes", () => {
		const frustum = buildRenderFrustumFromProjectionMatrix(
			buildSceneCameraViewProjectionMatrix(createCameraFrame()),
		);

		for (const plane of frustum.planes) {
			expect(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)).toBeCloseTo(
				1,
			);
		}
	});
});

function createBatch({
	id,
	kind,
	itemKeys = [],
	fallbackReason = null,
}: {
	id: string;
	kind: WorldRenderCandidate["kind"];
	itemKeys?: WorldRenderCandidate["bvhItemKeys"];
	fallbackReason?: string | null;
}): WorldRenderCandidate {
	return {
		id,
		kind,
		bvhItemKeys: itemKeys,
		bvhFallbackReason: fallbackReason,
	};
}

function buildFrameWithFallbackCandidates(
	candidates: readonly WorldRenderCandidate[],
) {
	return buildTestWorldRenderFrame(candidates);
}

function buildTestWorldRenderFrame(candidates: readonly WorldRenderCandidate[]) {
	return buildWorldRenderFrameImpl({
		assetReadModel: emptyAssetReadModel(),
		candidates,
		cameraFrame: createCameraFrame(),
		renderChunkTransforms: [],
		staticRenderableScene: createEmptyStaticRenderableSceneModel(),
		staticLandblockRenderProducts:
			createEmptyStaticLandblockRenderProductSet(),
		structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
		terrainScene: createTerrainScene(),
	});
}

function emptyAssetReadModel() {
	return createTestPreparedAssetResolver([]);
}

function createTerrainScene(): TerrainSceneModel {
	return {
		focusLandblockId: null,
		statusText: "test",
		cacheText: "test",
		dataSourceText: "test",
		tiles: [],
	};
}

function createCameraFrame(): SceneCameraFrame {
	return {
		position: { x: 0, y: 0, z: 10 },
		target: { x: 0, y: 0, z: 0 },
		up: { x: 0, y: 1, z: 0 },
		fovDegrees: 60,
		aspect: 1,
		near: 0.1,
		far: 100,
	};
}
