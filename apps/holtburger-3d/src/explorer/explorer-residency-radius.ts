import type { SceneInterestRadii } from "../lib/game/runtime/types";
import { EXPLORER_TUNING } from "./explorer-tuning";

export type ExplorerRadiusKind =
	"buildings" | "envCells" | "explicitObjects" | "generatedObjects" | "terrain";

/** Apply one Explorer residency-radius control while preserving the outdoor radius hierarchy. */
export function updateExplorerResidencyRadius(
	config: SceneInterestRadii,
	kind: ExplorerRadiusKind,
	value: number | null,
): SceneInterestRadii {
	const next = { ...config };
	switch (kind) {
		case "terrain":
			next.terrainRadius = clampRadius(value);
			next.buildingRadius = clampOptionalRadius(
				next.buildingRadius,
				next.terrainRadius,
			);
			next.envCellRadius = clampOptionalRadius(
				next.envCellRadius,
				next.terrainRadius,
			);
			next.explicitObjectRadius = clampOptionalRadius(
				next.explicitObjectRadius,
				next.buildingRadius,
			);
			next.generatedObjectRadius = clampOptionalRadius(
				next.generatedObjectRadius,
				next.buildingRadius,
			);
			return next;
		case "buildings":
			next.buildingRadius = clampOptionalRadius(value, next.terrainRadius);
			next.explicitObjectRadius = clampOptionalRadius(
				next.explicitObjectRadius,
				next.buildingRadius,
			);
			next.generatedObjectRadius = clampOptionalRadius(
				next.generatedObjectRadius,
				next.buildingRadius,
			);
			return next;
		case "envCells":
			next.envCellRadius = clampOptionalRadius(value, next.terrainRadius);
			return next;
		case "explicitObjects":
			next.explicitObjectRadius = clampOptionalRadius(
				value,
				next.buildingRadius,
			);
			return next;
		case "generatedObjects":
			next.generatedObjectRadius = clampOptionalRadius(
				value,
				next.buildingRadius,
			);
			return next;
	}
}

/** Return the Chebyshev-square coverage count for an enabled radius. */
export function countResidentLandblocks(radius: number): number {
	const normalized = clampRadius(radius);
	return (normalized * 2 + 1) ** 2;
}

/** Format an optional radius for its compact Explorer slider readout. */
export function formatResidencyRadius(radius: number | null): string {
	return radius === null
		? "Off"
		: `${radius} out (${countResidentLandblocks(radius)} landblocks)`;
}

function clampRadius(radius: number | null): number {
	if (radius === null || !Number.isFinite(radius))
		return EXPLORER_TUNING.residency.minimumRadius;
	return Math.min(
		EXPLORER_TUNING.residency.maximumRadius,
		Math.max(EXPLORER_TUNING.residency.minimumRadius, Math.trunc(radius)),
	);
}

function clampOptionalRadius(
	radius: number | null,
	maximum: number | null,
): number | null {
	if (radius === null || maximum === null) return null;
	return Math.min(clampRadius(radius), maximum);
}
