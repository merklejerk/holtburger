import { LandblockLayerKind } from "../runtime/scene-interest";

/** Active-region detail texture selected by one static render domain. */
export type StaticDetailRole = "building" | "environment" | "object";

/** Complete stable role order used for preparation, publication, and diagnostics. */
export const STATIC_DETAIL_ROLES: readonly StaticDetailRole[] = [
	"building",
	"environment",
	"object",
];

/**
 * Select the retail detail domain for a non-terrain static layer.
 *
 * Source-surface eligibility remains a separate material fact; this only identifies which
 * active-region binding an eligible material is allowed to consume.
 */
export function staticDetailRoleForLayer(
	layer: Exclude<LandblockLayerKind, LandblockLayerKind.Terrain>,
): StaticDetailRole {
	switch (layer) {
		case LandblockLayerKind.Buildings:
			return "building";
		case LandblockLayerKind.EnvCells:
			return "environment";
		case LandblockLayerKind.Generated:
		case LandblockLayerKind.Objects:
			return "object";
	}
}
