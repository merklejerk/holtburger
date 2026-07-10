import { describe, expect, it } from "vitest";
import {
	diffSceneInterest,
	LandblockLayerKind,
	type SceneInterestMap,
} from "./scene-interest";

function sceneInterest(
	entries: readonly [string, readonly LandblockLayerKind[]][],
): SceneInterestMap {
	return new Map(entries.map(([id, layers]) => [id, new Set(layers)]));
}

function layersInOrder(
	layers: Set<{ readonly id: string; readonly layer: LandblockLayerKind }>,
): readonly [string, LandblockLayerKind][] {
	return [...layers].map(({ id, layer }) => [id, layer]);
}

describe("diffSceneInterest", () => {
	it("reports layers added to the desired interest", () => {
		const result = diffSceneInterest(
			sceneInterest([["0002", [LandblockLayerKind.Terrain]]]),
			sceneInterest([
				["0002", [LandblockLayerKind.Terrain, LandblockLayerKind.Buildings]],
				["0003", [LandblockLayerKind.Objects]],
			]),
		);

		expect(layersInOrder(result.newLayers)).toEqual([
			["0002", LandblockLayerKind.Buildings],
			["0003", LandblockLayerKind.Objects],
		]);
		expect(result.evictedLayers).toHaveLength(0);
	});

	it("reports layers removed from the desired interest", () => {
		const result = diffSceneInterest(
			sceneInterest([
				["0002", [LandblockLayerKind.Terrain, LandblockLayerKind.Buildings]],
				["0003", [LandblockLayerKind.Objects]],
			]),
			sceneInterest([["0002", [LandblockLayerKind.Terrain]]]),
		);

		expect(layersInOrder(result.evictedLayers)).toEqual([
			["0002", LandblockLayerKind.Buildings],
			["0003", LandblockLayerKind.Objects],
		]);
		expect(result.newLayers).toHaveLength(0);
	});

	it("does not report unchanged layers", () => {
		const from = sceneInterest([
			["0002", [LandblockLayerKind.Terrain, LandblockLayerKind.Buildings]],
		]);
		const to = sceneInterest([
			["0002", [LandblockLayerKind.Terrain, LandblockLayerKind.Buildings]],
		]);

		const result = diffSceneInterest(from, to);

		expect(result.newLayers).toHaveLength(0);
		expect(result.evictedLayers).toHaveLength(0);
	});

	it("handles empty and missing landblock entries", () => {
		const result = diffSceneInterest(
			sceneInterest([]),
			sceneInterest([["0001", [LandblockLayerKind.Terrain]]]),
		);

		expect(layersInOrder(result.newLayers)).toEqual([
			["0001", LandblockLayerKind.Terrain],
		]);
		expect(result.evictedLayers).toHaveLength(0);
	});

	it("does not mutate either input map", () => {
		const from = sceneInterest([["0001", [LandblockLayerKind.Terrain]]]);
		const to = sceneInterest([["0002", [LandblockLayerKind.Objects]]]);

		diffSceneInterest(from, to);

		expect([...from.entries()]).toEqual([
			["0001", new Set([LandblockLayerKind.Terrain])],
		]);
		expect([...to.entries()]).toEqual([
			["0002", new Set([LandblockLayerKind.Objects])],
		]);
	});
});
