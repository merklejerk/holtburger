import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import type { SceneCameraFrame } from "./camera";
import {
	buildRenderFrustumFromProjectionMatrix,
	buildStagedWorldFrame,
	type StagedWorldFrameCandidate,
} from "./staged-world-frame";
import { buildSceneCameraViewProjectionMatrix } from "./luma-math";
import type { TerrainSceneModel } from "./terrain-scene";
import { createEmptyStaticRenderableSceneModel } from "./static-renderables";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";

describe("buildStagedWorldFrame", () => {
	it("culls keyed batches when no prepared BVH item is visible", () => {
		const frame = buildStagedWorldFrame({
			assetState: createInitialAssetChannelState(),
			candidates: [
				createBatch({
					id: "terrain/culled",
					kind: "terrain",
					itemKeys: ["terrain:landblock:0203ffff:quad:7"],
				}),
			],
			cameraFrame: createCameraFrame(),
			renderChunkTransforms: [],
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			terrainScene: createTerrainScene(),
		});

		expect(frame.passes).toEqual([{ id: "world", draws: [] }]);
		expect(frame.metrics.registeredBatchCount).toBe(1);
		expect(frame.metrics.keyedBatchCount).toBe(1);
		expect(frame.metrics.candidateBatchCount).toBe(0);
	});

	it("keeps unkeyed fallback batches visible and sorts draw categories", () => {
		const frame = buildStagedWorldFrame({
			assetState: createInitialAssetChannelState(),
			candidates: [
				createBatch({
					id: "static-staged/world|landblock/0203ffff|debug-flat/object-b",
					kind: "static",
					fallbackReason: "test staged static fallback",
				}),
				createBatch({
					id: "terrain/fallback",
					kind: "terrain",
					fallbackReason: "test terrain fallback",
				}),
			],
			cameraFrame: createCameraFrame(),
			renderChunkTransforms: [],
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			terrainScene: createTerrainScene(),
		});

		expect(frame.passes[0]?.draws).toEqual([
			{ drawUnitId: "terrain/fallback", category: "terrain" },
			{
				drawUnitId:
					"static-staged/world|landblock/0203ffff|debug-flat/object-b",
				category: "static-staged",
			},
		]);
		expect(frame.metrics.candidateBatchCount).toBe(2);
		expect(frame.metrics.unboundFallbackBatchCount).toBe(2);
		expect(frame.metrics.visibleDrawCountsByCategory.terrain).toBe(1);
		expect(frame.metrics.visibleDrawCountsByCategory["static-staged"]).toBe(1);
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
	kind: StagedWorldFrameCandidate["kind"];
	itemKeys?: StagedWorldFrameCandidate["bvhItemKeys"];
	fallbackReason?: string | null;
}): StagedWorldFrameCandidate {
	return {
		id,
		kind,
		bvhItemKeys: itemKeys,
		bvhFallbackReason: fallbackReason,
	};
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
