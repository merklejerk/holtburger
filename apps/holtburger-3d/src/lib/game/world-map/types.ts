/** Fixed software-baked overview format shared with the app-local host. */
export const WORLD_MAP_IMAGE_SIDE = 2048;
/** Tile geometry is a transfer unit, independent of terrain landblock boundaries. */
export const WORLD_MAP_TILE_SIDE = 128;
/** Canonical outdoor extent in scene meters. */
export const WORLD_MAP_EXTENT = 255 * 192;

/** North-up map extent in scene X/Z coordinates. */
export interface WorldMapBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

/** Host-owned pixel placement; row zero is north. */
interface WorldMapTile {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** One running or completed host image attempt, usable before every tile arrives. */
export interface WorldMapManifest {
	readonly version: 3;
	readonly receiptId: string;
	readonly width: number;
	readonly height: number;
	readonly bounds: WorldMapBounds;
	readonly tiles: readonly WorldMapTile[];
}

/** Validated consecutive tiles; buffers can be released after Canvas2D application. */
export interface WorldMapTileBatch {
	readonly firstTile: number;
	readonly state: "streaming" | "complete";
	readonly tiles: readonly Uint8ClampedArray<ArrayBuffer>[];
}

/** Projection inputs in scene meters; interaction never changes image residency. */
export interface WorldMapView {
	readonly centerX: number;
	readonly centerZ: number;
	readonly spanMeters: number;
}

/** Image capability shared by Electron and HTTP adapters. */
export interface WorldMapSource {
	open(intent: "open" | "retry"): Promise<WorldMapManifest>;
	readTiles(
		manifest: WorldMapManifest,
		nextTile: number,
	): Promise<WorldMapTileBatch>;
}
