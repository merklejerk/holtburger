import { describe, expect, it } from "vitest";
import {
	computeOutdoorSceneInterest,
	computeDungeonSceneInterest,
	diffSceneInterest,
	groupLandblockLayers,
	LandblockLayerKind,
	type LandblockIdLayer,
	type SceneInterestMap,
	validateSceneInterestRadiiOrThrow,
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

describe("groupLandblockLayers", () => {
	it("keeps every layer for one landblock in its shared acquisition group", () => {
		const layers = new Set<LandblockIdLayer>([
			{ id: "0x1010ffff", layer: LandblockLayerKind.Terrain },
			{ id: "0x1010ffff", layer: LandblockLayerKind.Buildings },
			{ id: "0x2020ffff", layer: LandblockLayerKind.Objects },
		]);

		expect([...groupLandblockLayers(layers).entries()]).toEqual([
			[
				"0x1010ffff",
				[
					{ id: "0x1010ffff", layer: LandblockLayerKind.Terrain },
					{ id: "0x1010ffff", layer: LandblockLayerKind.Buildings },
				],
			],
			["0x2020ffff", [{ id: "0x2020ffff", layer: LandblockLayerKind.Objects }]],
		]);
	});
});

describe("computeOutdoorSceneInterest", () => {
	it("supports terrain-only frontend interest", () => {
		const interest = computeOutdoorSceneInterest(
			"0x1010ffff",
			{
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 1,
			},
			new Set(),
		);

		expect(interest).toHaveLength(9);
		expect(
			[...interest.values()].every(
				(layers) => layers.size === 1 && layers.has(LandblockLayerKind.Terrain),
			),
		).toBe(true);
	});

	it("clips outdoor interest at the world edge", () => {
		const interest = computeOutdoorSceneInterest(
			"0x0000ffff",
			{
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 2,
			},
			new Set(),
		);

		expect(interest).toHaveLength(9);
		expect(interest.has("0x0202ffff")).toBe(true);
	});

	it("enables optional layers at their independent radii", () => {
		const interest = computeOutdoorSceneInterest(
			"0x1010ffff",
			{
				buildingRadius: 0,
				envCellRadius: 1,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 1,
			},
			new Set(["0x1010ffff", "0x0f0fffff"]),
		);

		expect(interest.get("0x1010ffff")).toEqual(
			new Set([
				LandblockLayerKind.Terrain,
				LandblockLayerKind.Buildings,
				LandblockLayerKind.EnvCells,
			]),
		);
		expect(interest.get("0x0f0fffff")).toEqual(
			new Set([LandblockLayerKind.Terrain, LandblockLayerKind.EnvCells]),
		);
	});

	it("rejects fractional and out-of-range optional radii", () => {
		expect(() =>
			validateSceneInterestRadiiOrThrow({
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 0.5,
			}),
		).toThrow("Invalid scene config");
		expect(() =>
			validateSceneInterestRadiiOrThrow({
				buildingRadius: 2,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 1,
			}),
		).toThrow("Invalid scene config");
	});
});

describe("dungeon scene-interest composition", () => {
	it("plans one owner EnvCells layer without terrain or radius expansion", () => {
		expect(computeDungeonSceneInterest("0x0005ffff")).toEqual(
			new Map([["0x0005ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);
	});
});
