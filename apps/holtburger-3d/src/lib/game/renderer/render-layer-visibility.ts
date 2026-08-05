import { LandblockLayerKind } from "../runtime/scene-interest";
import type { SceneCullingGroupFilter } from "../scene";
import type { RenderLayerVisibility } from "./renderer";

/**
 * Bind layer visibility into the SceneGraph producer-group broad phase.
 *
 * Producer groups outside the materialized landblock layers (dynamic entities, ungrouped nodes)
 * are not owned by this policy and always contribute.
 */
export function renderCullingGroupFilter(
	visibility: RenderLayerVisibility,
): SceneCullingGroupFilter {
	return (cullingGroup) => {
		switch (cullingGroup) {
			case LandblockLayerKind.Terrain:
				return visibility[LandblockLayerKind.Terrain];
			case LandblockLayerKind.Buildings:
				return visibility[LandblockLayerKind.Buildings];
			case LandblockLayerKind.Objects:
				return visibility[LandblockLayerKind.Objects];
			case LandblockLayerKind.Generated:
				return visibility[LandblockLayerKind.Generated];
			case "env-cell-shell":
			case "env-cell-static-residents":
				return visibility[LandblockLayerKind.EnvCells];
			default:
				return true;
		}
	};
}
