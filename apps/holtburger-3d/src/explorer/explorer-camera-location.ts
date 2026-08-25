import type { Vec3 } from "../lib/game/math/types";
import type { ExplorerResidencyResolution } from "./explorer-residency";

/** Camera position paired with the residency result resolved for that exact point. */
export interface ExplorerCameraLocation {
	readonly position: Vec3;
	readonly residency: ExplorerResidencyResolution;
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
