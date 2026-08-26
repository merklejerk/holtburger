import type { SceneSpatialPlacement } from "../scene";
import type {
	DynamicEntityAdvance,
	DynamicEntityAdvanceBatch,
} from "../runtime/dynamic-entity-feed";
import {
	interpolateDynamicEntityPlacement,
	dynamicEntityPlacementFromPoint,
} from "../runtime/dynamic-entity-presentation";
import { evaluateHostPlacedPath } from "./host-placed-path";

/** Evaluate one accepted entity path without performing portal traversal in the frontend. */
export function evaluateHostDynamicEntityPath(
	advance: DynamicEntityAdvance,
	durationMs: DynamicEntityAdvanceBatch["durationMs"],
	elapsedMs: number,
): SceneSpatialPlacement {
	const finalPoint = advance.path.legs[advance.path.legs.length - 1].end;
	if (advance.kind !== "integrated") {
		return dynamicEntityPlacementFromPoint(finalPoint);
	}
	return evaluateHostPlacedPath(advance.path, durationMs, elapsedMs, {
		interpolate: interpolateDynamicEntityPlacement,
		present: dynamicEntityPlacementFromPoint,
	});
}
