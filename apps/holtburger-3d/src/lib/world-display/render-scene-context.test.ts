import { describe, expect, it } from "vitest";

import { deriveWorldRenderSceneContext } from "./render-scene-context";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

describe("render scene context", () => {
	it("treats terrain-backed scenes as outdoor even when interiors are loaded", () => {
		expect(
			deriveWorldRenderSceneContext({
				activeRenderAnchor: { landblockId: 0xda55ffff },
				terrainScene: createTerrainScene(1),
				structuredInteriorScene: createStructuredInteriorScene(3),
			}),
		).toEqual({
			kind: "outdoor",
			anchorLandblockId: 0xda55ffff,
		});
	});

	it("treats interior-only scenes as dungeon render contexts", () => {
		expect(
			deriveWorldRenderSceneContext({
				activeRenderAnchor: { landblockId: 0x8a04ffff },
				terrainScene: createTerrainScene(0),
				structuredInteriorScene: createStructuredInteriorScene(4),
			}),
		).toEqual({
			kind: "dungeon",
			anchorLandblockId: 0x8a04ffff,
		});
	});
});

function createTerrainScene(tileCount: number): TerrainSceneModel {
	return {
		focusLandblockId: null,
		statusText: "test",
		cacheText: "test",
		dataSourceText: "test",
		tiles: Array.from({ length: tileCount }, (_, index) => ({
			assetId: `terrain/${index}`,
		})) as TerrainSceneModel["tiles"],
	};
}

function createStructuredInteriorScene(
	cellCount: number,
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: [],
		cells: Array.from({ length: cellCount }, (_, index) => ({
			renderKey: `cell/${index}`,
		})) as StructuredInteriorSceneModel["cells"],
		missingEnvCellAssetIds: [],
		missingEnvironmentAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "test",
		cacheText: "test",
	};
}

