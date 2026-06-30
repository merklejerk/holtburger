export interface OutdoorLandblockCoords {
	x: number;
	y: number;
}

export interface OutdoorCoverageLandblock {
	landblockId: number;
	offsetX: number;
	offsetY: number;
	distance: number;
}

export const OUTDOOR_LANDBLOCK_WORLD_SIZE = 192;

export function makeOutdoorLandblockId(x: number, y: number): number {
	return (((x & 0xff) << 24) | ((y & 0xff) << 16) | 0xffff) >>> 0;
}

export function normalizeOutdoorLandblockId(rawLandblockId: number): number {
	return ((rawLandblockId & 0xffff0000) | 0xffff) >>> 0;
}

export function getOutdoorLandblockCoords(
	landblockId: number,
): OutdoorLandblockCoords {
	const normalizedLandblockId = normalizeOutdoorLandblockId(landblockId);

	return {
		x: (normalizedLandblockId >>> 24) & 0xff,
		y: (normalizedLandblockId >>> 16) & 0xff,
	};
}

export function buildOutdoorCoverageLandblocks(
	focusLandblockId: number,
	landblockRadius: number,
): OutdoorCoverageLandblock[] {
	const center = getOutdoorLandblockCoords(focusLandblockId);
	const radius = Math.max(0, Math.trunc(landblockRadius));
	const landblocks: OutdoorCoverageLandblock[] = [];

	for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
		for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
			if (!isOutdoorCoverageOffsetIncluded(offsetX, offsetY, radius)) {
				continue;
			}

			const nextX = center.x + offsetX;
			const nextY = center.y + offsetY;

			if (nextX < 0 || nextX > 0xfe || nextY < 0 || nextY > 0xfe) {
				continue;
			}

			landblocks.push({
				landblockId: makeOutdoorLandblockId(nextX, nextY),
				offsetX,
				offsetY,
				distance: Math.hypot(offsetX, offsetY),
			});
		}
	}

	return landblocks.sort(compareOutdoorCoverageLandblocks);
}

export function isOutdoorCoverageOffsetIncluded(
	offsetX: number,
	offsetY: number,
	landblockRadius: number,
): boolean {
	const radius = Math.max(0, Math.trunc(landblockRadius));
	// Half-tile padding selects landblocks touched by the interest disk instead
	// of only landblocks whose centers are inside it. That keeps radius 1 from
	// degenerating into a cross-shaped footprint.
	const paddedRadius = radius + 0.5;

	return offsetX * offsetX + offsetY * offsetY <= paddedRadius * paddedRadius;
}

export function buildOutdoorCoverageLandblockIds(
	focusLandblockId: number,
	landblockRadius: number,
): number[] {
	return buildOutdoorCoverageLandblocks(focusLandblockId, landblockRadius).map(
		(landblock) => landblock.landblockId,
	);
}

export function formatLandblockLabel(landblockId: number): string {
	return `0x${formatHex32(landblockId)}`;
}

export function formatLandblockTopologyAssetId(landblockId: number): string {
	return `landblock/${formatHex32(normalizeOutdoorLandblockId(landblockId))}/topology`;
}

export function formatEnvCellAssetId(envCellId: number): string {
	return `env-cell/${formatHex32(envCellId)}`;
}

export function formatTerrainMaterialAssetId(regionNumber: number): string {
	return `terrain-material/${formatUnsignedRouteNumber(regionNumber)}`;
}

export function formatRegionRenderProfileAssetId(regionNumber: number): string {
	return `region-render-profile/${formatUnsignedRouteNumber(regionNumber)}`;
}

export function parseLandblockTopologyAssetId(assetId: string): number | null {
	const match = /^landblock\/([0-9a-fA-F]{8})\/topology$/.exec(assetId);
	return match ? Number.parseInt(match[1], 16) >>> 0 : null;
}

export function parseEnvCellAssetId(assetId: string): number | null {
	const match = /^env-cell\/([0-9a-fA-F]{8})$/.exec(assetId);
	return match ? Number.parseInt(match[1], 16) >>> 0 : null;
}

export function parseTerrainMaterialAssetId(
	assetId: string,
): { regionNumber: number } | null {
	const match = /^terrain-material\/(\d+)$/.exec(assetId);
	if (!match) {
		return null;
	}
	return {
		regionNumber: Number.parseInt(match[1], 10),
	};
}

export function deriveFirstEnvCellId(
	landblockId: number,
	numEnvCells: number,
): number | null {
	return numEnvCells > 0
		? ((normalizeOutdoorLandblockId(landblockId) & 0xffff0000) | 0x0100) >>> 0
		: null;
}

export function deriveLandblockEnvCellId(
	landblockId: number,
	index: number,
): number {
	const firstEnvCellId =
		((normalizeOutdoorLandblockId(landblockId) & 0xffff0000) | 0x0100) >>> 0;
	return (firstEnvCellId + Math.max(0, Math.trunc(index))) >>> 0;
}

export function deriveLandblockEnvCellIds(
	landblockId: number,
	numEnvCells: number,
): number[] {
	return Array.from(
		{ length: Math.max(0, Math.trunc(numEnvCells)) },
		(_, index) => deriveLandblockEnvCellId(landblockId, index),
	);
}

export function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}

function formatUnsignedRouteNumber(value: number): string {
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized) || normalized < 0) {
		throw new Error(
			`route number must be a nonnegative finite integer: ${value}`,
		);
	}
	return `${normalized}`;
}

function compareOutdoorCoverageLandblocks(
	left: OutdoorCoverageLandblock,
	right: OutdoorCoverageLandblock,
): number {
	if (left.distance !== right.distance) {
		return left.distance - right.distance;
	}
	if (left.offsetY !== right.offsetY) {
		return left.offsetY - right.offsetY;
	}
	return left.offsetX - right.offsetX;
}
