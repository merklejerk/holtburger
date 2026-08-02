import type { LoDConfig } from "../lib/game/runtime/types";

/** Smallest selectable outdoor scene-interest radius. */
export const MIN_EXPLORER_LOD_RADIUS = 0;
/** Largest Explorer radius, matching the legacy outdoor streaming control. */
export const MAX_EXPLORER_LOD_RADIUS = 8;

/** Explorer's initial full outdoor scene-interest policy. */
export const DEFAULT_EXPLORER_LOD_CONFIG: LoDConfig = {
	buildingRadius: 8,
	envCellRadius: 2,
	explicitObjectRadius: 2,
	generatedObjectRadius: 2,
	terrainRadius: 8,
};

export type ExplorerLodRadius =
	"buildings" | "envCells" | "explicitObjects" | "generatedObjects" | "terrain";

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
		return MIN_EXPLORER_LOD_RADIUS;
	return Math.min(
		MAX_EXPLORER_LOD_RADIUS,
		Math.max(MIN_EXPLORER_LOD_RADIUS, Math.trunc(radius)),
	);
}

function clampOptionalRadius(
	radius: number | null,
	maximum: number | null,
): number | null {
	if (radius === null || maximum === null) return null;
	return Math.min(clampRadius(radius), maximum);
}
