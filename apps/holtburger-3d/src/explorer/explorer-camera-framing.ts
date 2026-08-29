import type { LandblockOwnerId } from "../lib/game/game-types";
import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";
import { Vec3 } from "../lib/game/math/types";
import { createCameraLookAtAngles } from "../lib/game/math/camera-orientation";
import { EXPLORER_TUNING } from "./explorer-tuning";
import type { FreeFlyCameraPose } from "./explorer-camera-input-controller";

/** Minimal terrain query needed to reproduce the Explorer's automatic outdoor camera policy. */
export interface ExplorerOutdoorSurfaceQuery {
	queryOutdoorTerrainSurface(point: Vec3): {
		readonly height: number;
		readonly landblockId: LandblockOwnerId;
	} | null;
}

/** Resolve the Explorer's terrain-relative outdoor focus pose once its terrain is queryable. */
export function resolveExplorerOutdoorFocusPose(
	query: ExplorerOutdoorSurfaceQuery,
	landblockId: LandblockOwnerId,
): FreeFlyCameraPose | null {
	const origin = createLandblockWorldOrigin(landblockId);
	const center = new Vec3(
		origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		0,
		origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
	);
	const position = new Vec3(
		center.x + EXPLORER_TUNING.camera.outdoorFocus.offset,
		0,
		center.z + EXPLORER_TUNING.camera.outdoorFocus.offset,
	);
	const surface = query.queryOutdoorTerrainSurface(position);
	if (!surface || surface.landblockId !== landblockId) return null;
	const centerSurface = query.queryOutdoorTerrainSurface(center);
	position.y = surface.height + EXPLORER_TUNING.camera.outdoorFocus.clearance;
	center.y = centerSurface?.height ?? surface.height;
	return createLookAtPose(position, center);
}

function createLookAtPose(position: Vec3, target: Vec3): FreeFlyCameraPose {
	return {
		...createCameraLookAtAngles(position, target),
		position,
	};
}
