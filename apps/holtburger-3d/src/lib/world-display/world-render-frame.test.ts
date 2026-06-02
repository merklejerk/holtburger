import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import type { SceneCameraFrame } from "./camera";
import {
	buildRenderFrustumFromProjectionMatrix,
	buildWorldRenderFrame as buildWorldRenderFrameImpl,
	type WorldRenderCandidate,
} from "./world-render-frame";
import { buildSceneCameraViewProjectionMatrix } from "./render-math";
import type { TerrainSceneModel } from "./terrain-scene";
import { createEmptyStaticRenderableSceneModel } from "./static-renderables";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";

describe("buildWorldRenderFrame", () => {
	it("culls keyed batches when no prepared BVH item is visible", () => {
		const frame = buildWorldRenderFrameImpl({
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
		const frame = buildWorldRenderFrameImpl({
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
			{
				kind: "draw-unit",
				drawUnitId: "terrain/fallback",
				category: "terrain",
			},
			{
				kind: "draw-unit",
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

	it("keeps terrain tile resources visible without creating draw-unit refs", () => {
		const frame = buildFrameWithFallbackCandidates([
			createBatch({
				id: "terrain-tile/terrain/0203ffff",
				kind: "terrain-tile",
				fallbackReason: "test terrain tile fallback",
			}),
		]);

		expect(frame.passes[0]?.draws).toEqual([
			{
				kind: "terrain-tile",
				terrainTileId: "terrain-tile/terrain/0203ffff",
				category: "terrain",
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
		assetState: createInitialAssetChannelState(),
		candidates,
		cameraFrame: createCameraFrame(),
		renderChunkTransforms: [],
		staticRenderableScene: createEmptyStaticRenderableSceneModel(),
		structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
		terrainScene: createTerrainScene(),
	});
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
