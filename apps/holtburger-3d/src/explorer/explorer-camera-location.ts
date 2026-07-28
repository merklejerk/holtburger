import type { Vec3 } from "../lib/game/math/types";
import type { ExplorerResidencyResolution } from "./explorer-residency";

const METERS_PER_MAP_DEGREE = 240;
const MAP_COORDINATE_ORIGIN = 102;

/** Camera position paired with the residency result resolved for that exact point. */
export interface ExplorerCameraLocation {
	readonly position: Vec3;
	readonly residency: ExplorerResidencyResolution;
}

/** Format canonical scene coordinates using Asheron's Call's outdoor map notation. */
export function formatExplorerOutdoorCoordinates(
	position: Pick<Vec3, "x" | "z">,
): string {
	const latitude = -position.z / METERS_PER_MAP_DEGREE - MAP_COORDINATE_ORIGIN;
	const longitude = position.x / METERS_PER_MAP_DEGREE - MAP_COORDINATE_ORIGIN;
	return `${formatCoordinate(latitude, "N", "S")}, ${formatCoordinate(
		longitude,
		"E",
		"W",
	)}`;
}

/** Describe the camera's currently resolved environment-cell residency. */
export function formatExplorerCameraResidency(
	resolution: ExplorerResidencyResolution,
): string {
	switch (resolution.kind) {
		case "resolved":
			return (
				resolution.residency.envCellId ??
				`Outdoor ${resolution.residency.landblockId}`
			);
		case "ambiguous":
			return "Ambiguous EnvCell";
		case "outside":
			return "Outside world";
		case "topology-unavailable":
			return "Topology unavailable";
	}
}

function formatCoordinate(
	value: number,
	positiveHemisphere: string,
	negativeHemisphere: string,
): string {
	const hemisphere = value < 0 ? negativeHemisphere : positiveHemisphere;
	return `${Math.abs(value).toFixed(1)}${hemisphere}`;
}
