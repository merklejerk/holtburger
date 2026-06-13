import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
} from "../../lib/landblocks";

export function createOutdoorLandblockRootTranslation(
	landblockId: number,
	focusLandblockId: number | null,
): readonly [number, number, number] {
	if (focusLandblockId === null) {
		return [0, 0, 0];
	}

	const landblockCoords = getOutdoorLandblockCoords(landblockId);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);

	return [
		normalizeZero(
			(landblockCoords.x - focusCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		0,
		normalizeZero(
			-(landblockCoords.y - focusCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
	];
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
