import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";

/** std140-compatible bytes for integer atlas origin, screen origin, and tile extent. */
export const PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES = 32;
/** Fixed bytes for every scope ordinal addressable by one R8UI arrival route. */
export const PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES =
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES;
/** Byte offset of the tile's atlas X origin within one scope-tile metadata record. */
export const PORTAL_SCOPE_TILE_ATLAS_X_OFFSET_BYTES = 0;
/** Byte offset of the tile's atlas Y origin within one scope-tile metadata record. */
export const PORTAL_SCOPE_TILE_ATLAS_Y_OFFSET_BYTES = 4;
const PORTAL_SCOPE_TILE_SCREEN_X_OFFSET_BYTES = 8;
const PORTAL_SCOPE_TILE_SCREEN_Y_OFFSET_BYTES = 12;
/** Byte offset of the tile width within one scope-tile metadata record. */
export const PORTAL_SCOPE_TILE_WIDTH_OFFSET_BYTES = 16;
/** Byte offset of the tile height within one scope-tile metadata record. */
export const PORTAL_SCOPE_TILE_HEIGHT_OFFSET_BYTES = 20;
const PORTAL_SCOPE_TILE_FLAGS_OFFSET_BYTES = 24;
const PORTAL_SCOPE_TILE_RESERVED_OFFSET_BYTES = 28;
/** Marks a zero-crossing root domain whose deferred fragments need no envelope depth sample. */
export const PORTAL_SCOPE_TILE_UNBOUNDED_ENVELOPE_FLAG = 1;

const ATLAS_X_SLOT =
	PORTAL_SCOPE_TILE_ATLAS_X_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const ATLAS_Y_SLOT =
	PORTAL_SCOPE_TILE_ATLAS_Y_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const SCREEN_X_SLOT =
	PORTAL_SCOPE_TILE_SCREEN_X_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const SCREEN_Y_SLOT =
	PORTAL_SCOPE_TILE_SCREEN_Y_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const WIDTH_SLOT =
	PORTAL_SCOPE_TILE_WIDTH_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const HEIGHT_SLOT =
	PORTAL_SCOPE_TILE_HEIGHT_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const FLAGS_SLOT =
	PORTAL_SCOPE_TILE_FLAGS_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const RESERVED_SLOT =
	PORTAL_SCOPE_TILE_RESERVED_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;

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
	unboundedEnvelope: boolean,
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
	if (typeof unboundedEnvelope !== "boolean") {
		throw new Error(
			"Portal scope-tile unbounded-envelope flag must be boolean.",
		);
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
	target[uintOffset + ATLAS_X_SLOT] = atlasX;
	target[uintOffset + ATLAS_Y_SLOT] = atlasY;
	target[uintOffset + SCREEN_X_SLOT] = screenX;
	target[uintOffset + SCREEN_Y_SLOT] = screenY;
	target[uintOffset + WIDTH_SLOT] = width;
	target[uintOffset + HEIGHT_SLOT] = height;
	target[uintOffset + FLAGS_SLOT] = unboundedEnvelope
		? PORTAL_SCOPE_TILE_UNBOUNDED_ENVELOPE_FLAG
		: 0;
	target[uintOffset + RESERVED_SLOT] = 0;
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
		metadata[uintOffset + ATLAS_X_SLOT]! +
		screenPixelX -
		metadata[uintOffset + SCREEN_X_SLOT]!;
	target[targetOffset + 1] =
		metadata[uintOffset + ATLAS_Y_SLOT]! +
		screenPixelY -
		metadata[uintOffset + SCREEN_Y_SLOT]!;
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
		metadata[uintOffset + SCREEN_X_SLOT]! +
		atlasPixelX -
		metadata[uintOffset + ATLAS_X_SLOT]!;
	target[targetOffset + 1] =
		metadata[uintOffset + SCREEN_Y_SLOT]! +
		atlasPixelY -
		metadata[uintOffset + ATLAS_Y_SLOT]!;
}

/** Position a unit-tile vertex directly in full-atlas NDC for one instanced atlas-tile draw. */
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
	const atlasPixelX =
		metadata[uintOffset + ATLAS_X_SLOT]! +
		metadata[uintOffset + WIDTH_SLOT]! * unitX;
	const atlasPixelY =
		metadata[uintOffset + ATLAS_Y_SLOT]! +
		metadata[uintOffset + HEIGHT_SLOT]! * unitY;
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
