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
import { compileTerrainCompositionTable } from "../terrain/composition-table";
import { resolveTerrainMaterialTable } from "../terrain/terrain-materials";
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

	it("bounds landblock batches before they enter the host pipeline", async () => {
		let active = 0;
		let maximumActive = 0;
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const requests: string[] = [];
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async (layers) => {
				const owner = [...layers][0]?.id;
				if (owner === undefined) throw new Error("Batch lost its owner.");
				requests.push(owner);
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				await held;
				active -= 1;
				return [];
			},
		};
		const coordinator = new SceneInterestCommitCoordinator(
			pipeline,
			callbacks,
			3,
		);

		coordinator.reconcile(terrainInterest(8));

		await vi.waitFor(() => expect(requests).toHaveLength(3));
		expect(maximumActive).toBe(3);
		release();
		await vi.waitFor(() => expect(requests).toHaveLength(8));
		await vi.waitFor(() =>
			expect(callbacks.unavailable).toHaveBeenCalledTimes(8),
		);
		expect(maximumActive).toBe(3);
	});

	it("drops a superseded queued landblock before invoking the pipeline", async () => {
		let releaseFirst!: () => void;
		const held = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const owners = ["0x0000ffff", "0x0001ffff"];
		const requests: string[] = [];
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async (layers) => {
				const owner = [...layers][0]?.id;
				if (owner === undefined) throw new Error("Batch lost its owner.");
				requests.push(owner);
				if (requests.length === 1) await held;
				return [];
			},
		};
		const coordinator = new SceneInterestCommitCoordinator(
			pipeline,
			callbacks,
			1,
		);

		coordinator.reconcile(terrainInterest(owners.length));
		await vi.waitFor(() => expect(requests).toEqual([owners[0]]));
		coordinator.reconcile(
			new Map([[owners[0], new Set([LandblockLayerKind.Terrain])]]),
		);
		releaseFirst();

		await vi.waitFor(() =>
			expect(callbacks.unavailable).toHaveBeenCalledTimes(1),
		);
		await Promise.resolve();
		expect(requests).toEqual([owners[0]]);
		expect(callbacks.evict).toHaveBeenCalledWith({
			layer: { id: owners[1], layer: LandblockLayerKind.Terrain },
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
					cellDiagonals: new Uint8Array(64),
					gridSize: 9,
					heightIndices: new Uint8Array(81),
					heights: new Float32Array(81),
					landblockId,
					terrainSamples: new Uint16Array(81),
					tileSize: 24,
				},
				presentation: {
					composition: TERRAIN_COMPOSITION,
					compositionTable: compileTerrainCompositionTable(
						TERRAIN_COMPOSITION,
						resolveTerrainTextureFacts(TERRAIN_COMPOSITION),
					),
					textures: resolveTerrainTextureFacts(TERRAIN_COMPOSITION),
				},
			},
			landblockId,
			layer,
		};
	}
	const source = {
		dynamicSources: [],
		landblockId,
		staticResidents: [],
	};
	if (layer === LandblockLayerKind.Buildings) {
		return {
			commit: { source: { ...source, kind: layer, mapBlockers: new Map() } },
			landblockId,
			layer,
		};
	}
	return {
		commit: { source: { ...source, kind: layer } },
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
	terrainMaterials: resolveTerrainMaterialTable([
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
	]),
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

function terrainInterest(count: number): SceneInterestMap {
	return new Map(
		Array.from({ length: count }, (_, index) => [
			`0x${index.toString(16).padStart(4, "0")}ffff`,
			new Set([LandblockLayerKind.Terrain]),
		]),
	);
}
