import type { RenderLandblockAnchor } from "./render-chunks";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

export type WorldRenderSceneContextKind = "outdoor" | "dungeon";

export interface WorldRenderSceneContext {
	kind: WorldRenderSceneContextKind;
	anchorLandblockId: number | null;
}

export function deriveWorldRenderSceneContext(options: {
	activeRenderAnchor: RenderLandblockAnchor | null;
	terrainScene: TerrainSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
}): WorldRenderSceneContext {
	return {
		kind:
			options.terrainScene.tiles.length === 0 &&
			options.structuredInteriorScene.cells.length > 0
				? "dungeon"
				: "outdoor",
		anchorLandblockId: options.activeRenderAnchor?.landblockId ?? null,
	};
}
