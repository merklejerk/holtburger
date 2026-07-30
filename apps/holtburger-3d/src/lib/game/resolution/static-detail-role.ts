import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ResolvedStaticObjectLayerSource } from "./landblock-layer";

/** Active-region detail texture selected by one static render domain. */
export type StaticDetailRole = "building" | "environment" | "object";

/** Complete stable role order used for preparation, publication, and diagnostics. */
export const STATIC_DETAIL_ROLES: readonly StaticDetailRole[] = [
	"building",
	"environment",
	"object",
];

/**
 * Select the retail detail domain for a source of static object geometry.
 *
 * EnvCell sources contain resident objects; CellStruct shells select the environment role
 * directly at their separate materialization boundary.
 */
export function staticObjectDetailRoleForSource(
	source: ResolvedStaticObjectLayerSource,
): StaticDetailRole {
	switch (source.kind) {
		case LandblockLayerKind.Buildings:
			return "building";
		case LandblockLayerKind.EnvCells:
		case LandblockLayerKind.Generated:
		case LandblockLayerKind.Objects:
			return "object";
	}
}
