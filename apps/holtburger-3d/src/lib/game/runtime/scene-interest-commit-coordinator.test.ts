import { describe, expect, it, vi } from "vitest";
import type { CommitPipeline, LandblockLayerCommit } from "../commit/types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
	type SceneInterestMap,
} from "./scene-interest";
import {
	resolveTerrainTextureFacts,
	type TerrainCompositionFacts,
} from "../terrain/types";
import {
	SceneInterestCommitCoordinator,
	type SceneInterestCommitCoordinatorCallbacks,
} from "./scene-interest-commit-coordinator";

const landblockId = "0xda55ffff" as const;

describe("SceneInterestCommitCoordinator", () => {
	it("prepares every newly requested layer of one landblock as one batch", async () => {
		const requests: LandblockIdLayer[][] = [];
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async (layers) => {
				requests.push([...layers]);
				return [...layers].map(({ layer }) => artifact(layer));
			},
		};
		const coordinator = new SceneInterestCommitCoordinator(pipeline, callbacks);

		coordinator.reconcile(
			sceneInterest([
				LandblockLayerKind.Terrain,
				LandblockLayerKind.Buildings,
				LandblockLayerKind.Objects,
			]),
		);

		await vi.waitFor(() => expect(callbacks.prepared).toHaveBeenCalledTimes(3));

		expect(requests).toEqual([
			[
				{ id: landblockId, layer: LandblockLayerKind.Terrain },
				{ id: landblockId, layer: LandblockLayerKind.Buildings },
				{ id: landblockId, layer: LandblockLayerKind.Objects },
			],
		]);
		expect(callbacks.unavailable).not.toHaveBeenCalled();
	});

	it("marks only an omitted layer unavailable after a successful batch", async () => {
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async () => [
				artifact(LandblockLayerKind.Buildings),
			],
		};
		const coordinator = new SceneInterestCommitCoordinator(pipeline, callbacks);

		coordinator.reconcile(
			sceneInterest([LandblockLayerKind.Buildings, LandblockLayerKind.Objects]),
		);

		await vi.waitFor(() =>
			expect(callbacks.unavailable).toHaveBeenCalledTimes(1),
		);

		expect(callbacks.prepared).toHaveBeenCalledWith({
			artifact: artifact(LandblockLayerKind.Buildings),
			revision: 1,
		});
		expect(callbacks.unavailable).toHaveBeenCalledWith({
			layer: { id: landblockId, layer: LandblockLayerKind.Objects },
			revision: 1,
		});
	});
});

function artifact(layer: LandblockLayerKind): LandblockLayerCommit {
	if (
		layer !== LandblockLayerKind.Terrain &&
		layer !== LandblockLayerKind.Buildings &&
		layer !== LandblockLayerKind.Objects
	) {
		throw new Error(`Coordinator fixture does not support ${layer}.`);
	}
	if (layer === LandblockLayerKind.Terrain) {
		return {
			commit: {
				generation: {
					gridSize: 9,
					heightIndices: new Uint8Array(81),
					heights: new Float32Array(81),
					landblockId,
					terrainSamples: new Uint16Array(81),
					tileSize: 24,
				},
				presentation: {
					composition: TERRAIN_COMPOSITION,
					textures: resolveTerrainTextureFacts(TERRAIN_COMPOSITION),
				},
			},
			landblockId,
			layer,
		};
	}
	return {
		commit: {
			source: {
				dynamicSources: [],
				kind: layer,
				landblockId,
				staticResidents: [],
			},
		},
		landblockId,
		layer,
	};
}

const TERRAIN_COMPOSITION: TerrainCompositionFacts = {
	activeRegionKey: "coordinator-test",
	cornerTerrainAlphaMaps: [
		{ blendMaskTextureId: "0x05000002", terrainCode: 1 },
	],
	landscapeDetail: { textureId: "0x05000001", tiling: 1 },
	roadAlphaMaps: [{ roadCode: 1, roadMaskTextureId: "0x05000003" }],
	sideTerrainAlphaMaps: [],
	terrainTypes: [
		{
			colorTextureId: "0x05000001",
			colorVariation: {
				maxVertexBrightness: 1,
				maxVertexHue: 1,
				maxVertexSaturation: 1,
				minVertexBrightness: 1,
				minVertexHue: 1,
				minVertexSaturation: 1,
			},
			terrainType: 0,
			tiling: 1,
		},
	],
};

function createCallbacks() {
	return {
		evict: vi.fn<SceneInterestCommitCoordinatorCallbacks["evict"]>(),
		failed: vi.fn<SceneInterestCommitCoordinatorCallbacks["failed"]>(),
		prepared: vi.fn<SceneInterestCommitCoordinatorCallbacks["prepared"]>(),
		unavailable:
			vi.fn<SceneInterestCommitCoordinatorCallbacks["unavailable"]>(),
	};
}

function sceneInterest(
	layers: readonly LandblockLayerKind[],
): SceneInterestMap {
	return new Map([[landblockId, new Set(layers)]]);
}
