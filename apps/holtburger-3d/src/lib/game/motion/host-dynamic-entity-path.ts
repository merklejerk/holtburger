import type { ScenePlacement } from "../scene";
import type {
	DynamicEntityAdvance,
	DynamicEntityAdvanceBatch,
} from "../runtime/dynamic-entity-feed";
import {
	interpolateSpawnedDynamicPlacement,
	spawnedDynamicPlacementFromPose,
} from "../runtime/spawned-dynamic-presentation";
import { evaluateHostPlacedPath } from "./host-placed-path";

/** Evaluate one accepted entity path without performing portal traversal in the frontend. */
export function evaluateHostDynamicEntityPath(
	advance: DynamicEntityAdvance,
	durationMs: DynamicEntityAdvanceBatch["durationMs"],
	elapsedMs: number,
): ScenePlacement {
	const finalPoint = advance.path.legs[advance.path.legs.length - 1].end;
	if (advance.kind !== "integrated") {
		return spawnedDynamicPlacementFromPose(finalPoint.pose);
	}
	return evaluateHostPlacedPath(advance.path, durationMs, elapsedMs, {
		interpolate: (start, end, fraction) =>
			interpolateSpawnedDynamicPlacement(start.pose, end.pose, fraction),
		present: (point) => spawnedDynamicPlacementFromPose(point.pose),
	});
}
