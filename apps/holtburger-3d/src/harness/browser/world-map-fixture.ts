import {
	WORLD_MAP_IMAGE_SIDE,
	WORLD_MAP_TILE_SIDE,
	WORLD_MAP_EXTENT,
	type WorldMapManifest,
	type WorldMapSource,
} from "../../lib/game/world-map/types";

/** Synthetic image stream with controllable availability for actual panel lifecycle checks. */
export function createWorldMapFixture() {
	const columns = WORLD_MAP_IMAGE_SIDE / WORLD_MAP_TILE_SIDE;
	const tiles = Array.from({ length: columns ** 2 }, (_, index) => ({
		x: (index % columns) * WORLD_MAP_TILE_SIDE,
		y: Math.floor(index / columns) * WORLD_MAP_TILE_SIDE,
		width: WORLD_MAP_TILE_SIDE,
		height: WORLD_MAP_TILE_SIDE,
	}));
	const manifest: WorldMapManifest = {
		version: 3,
		receiptId: "synthetic-hud-world-map",
		width: WORLD_MAP_IMAGE_SIDE,
		height: WORLD_MAP_IMAGE_SIDE,
		bounds: {
			minX: 0,
			minZ: -WORLD_MAP_EXTENT,
			maxX: WORLD_MAP_EXTENT,
			maxZ: 0,
		},
		tiles,
	};
	let opens = 0,
		tileReads = 0,
		deliveredTiles = 0,
		available = tiles.length;
	let held = false;
	const waiters = new Set<() => void>();
	const wake = () => {
		for (const resolve of waiters) resolve();
		waiters.clear();
	};
	const source: WorldMapSource = {
		async open() {
			opens++;
			return manifest;
		},
		async readTiles(_, nextTile) {
			tileReads++;
			while (held && available <= nextTile)
				await new Promise<void>((resolve) => waiters.add(resolve));
			const count = Math.min(16, available - nextTile);
			deliveredTiles += count;
			return {
				firstTile: nextTile,
				state:
					!held && nextTile + count === tiles.length ? "complete" : "streaming",
				tiles: Array.from({ length: count }, (_, index) => {
					const bytes = new Uint8ClampedArray(WORLD_MAP_TILE_SIDE ** 2 * 4);
					for (let pixel = 0; pixel < bytes.length; pixel += 4)
						bytes.set([70 + ((nextTile + index) % 80), 130, 75, 255], pixel);
					return bytes;
				}),
			};
		},
	};
	return {
		source,
		holdPreparation() {
			held = true;
			available = 1;
		},
		advancePreparation() {
			if (!held) throw new Error("Fixture stream is not held.");
			available = Math.floor(tiles.length / 2);
			wake();
		},
		releasePreparation() {
			if (!held) throw new Error("Fixture stream is not held.");
			held = false;
			available = tiles.length;
			wake();
		},
		read: () => ({
			opens,
			tileReads,
			deliveredTiles,
			expectedTiles: tiles.length,
		}),
	};
}
