import type { LandblockId } from "../lib/game/game-types";
import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";
import { Vec3 } from "../lib/game/math/types";
import type { FreeFlyCameraPose } from "./free-fly-camera-controller";

/** Camera projection shared by every Explorer-controlled primary view. */
export const EXPLORER_CAMERA_FRAMING = {
	far: 2_000,
	fov: 60,
	near: 0.5,
} as const;

const OUTDOOR_FOCUS_CLEARANCE = 48;
const OUTDOOR_FOCUS_OFFSET = 48;

/** Minimal terrain query needed to reproduce the Explorer's automatic outdoor camera policy. */
export interface ExplorerOutdoorSurfaceQuery {
	queryOutdoorTerrainSurface(point: Vec3): {
		readonly height: number;
		readonly landblockId: LandblockId;
	} | null;
}

/** Resolve the Explorer's terrain-relative outdoor focus pose once its terrain is queryable. */
export function resolveExplorerOutdoorFocusPose(
	query: ExplorerOutdoorSurfaceQuery,
	landblockId: LandblockId,
): FreeFlyCameraPose | null {
	const origin = createLandblockWorldOrigin(landblockId);
	const center = new Vec3(
		origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		0,
		origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
	);
	const position = new Vec3(
		center.x + OUTDOOR_FOCUS_OFFSET,
		0,
		center.z + OUTDOOR_FOCUS_OFFSET,
	);
	const surface = query.queryOutdoorTerrainSurface(position);
	if (!surface || surface.landblockId !== landblockId) return null;
	const centerSurface = query.queryOutdoorTerrainSurface(center);
	position.y = surface.height + OUTDOOR_FOCUS_CLEARANCE;
	center.y = centerSurface?.height ?? surface.height;
	return createLookAtPose(position, center);
}

function createLookAtPose(position: Vec3, target: Vec3): FreeFlyCameraPose {
	const lookX = target.x - position.x;
	const lookY = target.y - position.y;
	const lookZ = target.z - position.z;
	const length = Math.hypot(lookX, lookY, lookZ);
	if (length === 0) {
		throw new Error("Automatic camera focus target matches its position.");
	}
	return {
		pitchRadians: Math.asin(lookY / length),
		position,
		yawRadians: Math.atan2(lookX, -lookZ),
	};
}
