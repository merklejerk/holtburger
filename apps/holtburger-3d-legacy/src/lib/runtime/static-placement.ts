import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
} from "../../lib/landblocks";
export { createOutdoorLandblockRootTranslation } from "../static/placement";
import { createOutdoorLandblockRootTranslation } from "../static/placement";

export interface OutdoorCameraLandblockResidency {
	readonly landblockId: number;
	readonly localCameraPosition: readonly [number, number, number];
	readonly rebaseTranslation: readonly [number, number, number];
}

export function deriveOutdoorCameraLandblockResidency(options: {
	readonly anchorLandblockId: number;
	readonly cameraPosition: readonly [number, number, number];
}): OutdoorCameraLandblockResidency | null {
	const anchorCoords = getOutdoorLandblockCoords(options.anchorLandblockId);
	const offsetX = Math.floor(
		options.cameraPosition[0] / OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
	const offsetY = Math.floor(
		-options.cameraPosition[2] / OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
	const nextX = anchorCoords.x + offsetX;
	const nextY = anchorCoords.y + offsetY;

	if (nextX < 0 || nextX > 0xfe || nextY < 0 || nextY > 0xfe) {
		return null;
	}

	const landblockId = makeOutdoorLandblockId(nextX, nextY);
	const rebaseTranslation = createOutdoorLandblockRootTranslation(
		options.anchorLandblockId,
		landblockId,
	);

	return {
		landblockId,
		localCameraPosition: [
			normalizeZero(options.cameraPosition[0] + rebaseTranslation[0]),
			normalizeZero(options.cameraPosition[1] + rebaseTranslation[1]),
			normalizeZero(options.cameraPosition[2] + rebaseTranslation[2]),
		],
		rebaseTranslation,
	};
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
