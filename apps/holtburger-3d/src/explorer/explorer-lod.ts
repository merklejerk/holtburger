import type { LoDConfig } from "../lib/game/runtime/types";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";

export type ExplorerLodRadius =
	| "buildings"
	| "envCells"
	| "explicitObjects"
	| "generatedObjects"
	| "terrain";

/** Apply one Explorer LoD control while preserving the outdoor radius hierarchy. */
export function updateExplorerLodRadius(
	config: LoDConfig,
	kind: ExplorerLodRadius,
	value: number | null,
): LoDConfig {
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
export function countExplorerLodLandblocks(radius: number): number {
	const normalized = clampRadius(radius);
	return (normalized * 2 + 1) ** 2;
}

/** Format an optional radius for its compact Explorer slider readout. */
export function formatExplorerLodRadius(radius: number | null): string {
	return radius === null
		? "Off"
		: `${radius} out (${countExplorerLodLandblocks(radius)} landblocks)`;
}

function clampRadius(radius: number | null): number {
	if (radius === null || !Number.isFinite(radius))
		return FRONTEND_TUNING.explorer.lod.minimumRadius;
	return Math.min(
		FRONTEND_TUNING.explorer.lod.maximumRadius,
		Math.max(FRONTEND_TUNING.explorer.lod.minimumRadius, Math.trunc(radius)),
	);
}

function clampOptionalRadius(
	radius: number | null,
	maximum: number | null,
): number | null {
	if (radius === null || maximum === null) return null;
	return Math.min(clampRadius(radius), maximum);
}
