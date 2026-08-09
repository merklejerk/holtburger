import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";

/** std140-compatible bytes for integer atlas origin, screen origin, and tile extent. */
export const PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES = 32;
/** Fixed bytes for every scope ordinal addressable by one R8UI arrival route. */
export const PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES =
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES;

/** Write one exact integer mapping between a drawing-buffer window and its atlas tile. */
export function writePortalScopeTileMetadata(
	target: Uint32Array,
	uintOffset: number,
	atlasX: number,
	atlasY: number,
	screenX: number,
	screenY: number,
	width: number,
	height: number,
): void {
	const slotCount =
		PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
	if (
		!Number.isInteger(uintOffset) ||
		uintOffset < 0 ||
		uintOffset + slotCount > target.length
	) {
		throw new Error("Portal scope-tile metadata exceeds its target.");
	}
	for (const [name, value, minimum] of [
		["atlas x", atlasX, 0],
		["atlas y", atlasY, 0],
		["screen x", screenX, 0],
		["screen y", screenY, 0],
		["width", width, 1],
		["height", height, 1],
	] as const) {
		if (
			!Number.isSafeInteger(value) ||
			value < minimum ||
			value > 0xffff_ffff
		) {
			throw new Error(
				`Portal scope-tile ${name} must fit an unsigned 32-bit integer.`,
			);
		}
	}
	target[uintOffset] = atlasX;
	target[uintOffset + 1] = atlasY;
	target[uintOffset + 2] = screenX;
	target[uintOffset + 3] = screenY;
	target[uintOffset + 4] = width;
	target[uintOffset + 5] = height;
	target[uintOffset + 6] = 0;
	target[uintOffset + 7] = 0;
}

/** Map a drawing-buffer pixel edge into atlas pixel coordinates without constructing a point. */
export function writePortalScopeAtlasPixel(
	metadata: Uint32Array,
	uintOffset: number,
	screenPixelX: number,
	screenPixelY: number,
	target: Float64Array,
	targetOffset: number,
): void {
	requirePointTarget(target, targetOffset);
	target[targetOffset] =
		metadata[uintOffset]! + screenPixelX - metadata[uintOffset + 2]!;
	target[targetOffset + 1] =
		metadata[uintOffset + 1]! + screenPixelY - metadata[uintOffset + 3]!;
}

/** Invert one atlas pixel edge back into the drawing-buffer coordinates sampled by reduction. */
export function writePortalScopeScreenPixel(
	metadata: Uint32Array,
	uintOffset: number,
	atlasPixelX: number,
	atlasPixelY: number,
	target: Float64Array,
	targetOffset: number,
): void {
	requirePointTarget(target, targetOffset);
	target[targetOffset] =
		metadata[uintOffset + 2]! + atlasPixelX - metadata[uintOffset]!;
	target[targetOffset + 1] =
		metadata[uintOffset + 3]! + atlasPixelY - metadata[uintOffset + 1]!;
}

/** Position a unit-tile vertex directly in full-atlas NDC for one instanced reduction draw. */
export function writePortalScopeTileAtlasNdc(
	metadata: Uint32Array,
	uintOffset: number,
	unitX: number,
	unitY: number,
	atlasWidth: number,
	atlasHeight: number,
	target: Float64Array,
	targetOffset: number,
): void {
	if (
		!Number.isFinite(unitX) ||
		!Number.isFinite(unitY) ||
		!Number.isSafeInteger(atlasWidth) ||
		atlasWidth <= 0 ||
		!Number.isSafeInteger(atlasHeight) ||
		atlasHeight <= 0
	) {
		throw new Error("Portal scope-tile NDC input is invalid.");
	}
	requirePointTarget(target, targetOffset);
	const atlasPixelX = metadata[uintOffset]! + metadata[uintOffset + 4]! * unitX;
	const atlasPixelY =
		metadata[uintOffset + 1]! + metadata[uintOffset + 5]! * unitY;
	target[targetOffset] = (2 * atlasPixelX) / atlasWidth - 1;
	target[targetOffset + 1] = (2 * atlasPixelY) / atlasHeight - 1;
}

function requirePointTarget(target: Float64Array, targetOffset: number): void {
	if (
		!Number.isInteger(targetOffset) ||
		targetOffset < 0 ||
		targetOffset + 2 > target.length
	) {
		throw new Error("Portal scope-tile point exceeds its output target.");
	}
}
