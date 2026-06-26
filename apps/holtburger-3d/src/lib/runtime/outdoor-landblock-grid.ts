import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
} from "../../lib/landblocks";
import type { StaticBounds } from "../static/contracts";

export const LAND_BLOCK_GRID_EPSILON = 1e-8;

export function projectLandblockIdToRenderCell(
	landblockId: number,
	outdoorAnchorLandblockId: number,
): { readonly cellX: number; readonly cellZ: number } {
	const landblockCoords = getOutdoorLandblockCoords(landblockId);
	const anchorCoords = getOutdoorLandblockCoords(outdoorAnchorLandblockId);

	return {
		cellX: landblockCoords.x - anchorCoords.x,
		// Local outdoor render Z runs from -landblockSize to 0, so the anchor
		// landblock lives in render cell Z -1 rather than 0.
		cellZ: anchorCoords.y - landblockCoords.y - 1,
	};
}

export function createRenderCellKey(cellX: number, cellZ: number): string {
	return `${cellX}:${cellZ}`;
}

export function parseRenderCellKey(key: string): {
	readonly cellX: number;
	readonly cellZ: number;
} {
	const [cellX, cellZ] = key
		.split(":")
		.map((entry) => Number.parseInt(entry, 10));
	if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
		throw new Error(`Invalid landblock render cell key: ${key}`);
	}

	return { cellX, cellZ };
}

function outdoorLandblockIdForRenderCell(
	anchorLandblockId: number,
	cell: { readonly cellX: number; readonly cellZ: number },
): number | null {
	const anchorCoords = getOutdoorLandblockCoords(anchorLandblockId);
	const x = anchorCoords.x + cell.cellX;
	const y = anchorCoords.y - cell.cellZ - 1;
	if (x < 0 || x > 0xfe || y < 0 || y > 0xfe) {
		return null;
	}
	return makeOutdoorLandblockId(x, y);
}

export function outdoorLandblockIdsForSourceLocalBounds(
	sourceLandblockId: number,
	bounds: StaticBounds,
): readonly number[] {
	return createRenderCellKeysForBounds(bounds)
		.map(parseRenderCellKey)
		.map((cell) => outdoorLandblockIdForRenderCell(sourceLandblockId, cell))
		.filter((landblockId): landblockId is number => landblockId !== null)
		.sort((left, right) => left - right);
}

export function createRenderCellKeysForBounds(
	bounds: StaticBounds,
): readonly string[] {
	const minCellX = gridCellAt(bounds.min.x, 1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const maxCellX = gridCellAt(bounds.max.x, -1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const minCellZ = gridCellAt(bounds.min.z, 1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const maxCellZ = gridCellAt(bounds.max.z, -1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const cellKeys: string[] = [];

	for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
		for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
			cellKeys.push(createRenderCellKey(cellX, cellZ));
		}
	}

	return cellKeys;
}

export function gridCellAt(
	value: number,
	direction: number,
	cellSize: number,
): number {
	const scaled = value / cellSize;
	const rounded = Math.round(scaled);
	if (direction < 0 && Math.abs(scaled - rounded) < LAND_BLOCK_GRID_EPSILON) {
		return rounded - 1;
	}

	return Math.floor(scaled);
}
