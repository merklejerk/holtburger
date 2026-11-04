import { z } from "zod";
import {
	WORLD_MAP_IMAGE_SIDE,
	WORLD_MAP_TILE_SIDE,
	WORLD_MAP_EXTENT,
	type WorldMapManifest,
	type WorldMapTileBatch,
} from "../game/world-map/types";
const integer = z.number().int().nonnegative();
const manifestSchema = z
	.object({
		version: z.literal(3),
		receiptId: z.string().min(1),
		width: z.literal(WORLD_MAP_IMAGE_SIDE),
		height: z.literal(WORLD_MAP_IMAGE_SIDE),
		bounds: z
			.object({
				minX: z.literal(0),
				minZ: z.literal(-WORLD_MAP_EXTENT),
				maxX: z.literal(WORLD_MAP_EXTENT),
				maxZ: z.literal(0),
			})
			.strict(),
		tiles: z
			.array(
				z
					.object({
						x: integer,
						y: integer,
						width: z.literal(WORLD_MAP_TILE_SIDE),
						height: z.literal(WORLD_MAP_TILE_SIDE),
					})
					.strict(),
			)
			.length((WORLD_MAP_IMAGE_SIDE / WORLD_MAP_TILE_SIDE) ** 2),
	})
	.strict();
const batchSchema = z
	.object({
		receiptId: z.string(),
		firstTile: integer,
		tileCount: integer,
		state: z.enum(["streaming", "complete"]),
	})
	.strict();

/** Validate the host's complete image partition once at the external boundary. */
export function decodeWorldMapManifest(value: unknown): WorldMapManifest {
	const manifest = manifestSchema.parse(value);
	const columns = manifest.width / WORLD_MAP_TILE_SIDE;
	for (const [index, tile] of manifest.tiles.entries()) {
		if (
			tile.x !== (index % columns) * WORLD_MAP_TILE_SIDE ||
			tile.y !== Math.floor(index / columns) * WORLD_MAP_TILE_SIDE
		)
			throw new Error(
				"World-map image tiles have a gap, overlap, or noncanonical order.",
			);
	}
	return manifest;
}

/** Read an existing app-host binary envelope while preserving typed-view alignment. */
function envelope(
	bytes: Uint8Array,
	magic: string,
): { readonly header: unknown; readonly data: Uint8Array } {
	if (bytes.byteLength < 12)
		throw new Error("World-map envelope is truncated.");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (new TextDecoder().decode(bytes.subarray(0, 4)) !== magic)
		throw new Error(`World-map envelope requires ${magic}.`);
	const base = 12 + view.getUint32(4, true);
	if (
		view.getUint32(8, true) !== bytes.byteLength ||
		base > bytes.byteLength ||
		base % 4 !== 0
	)
		throw new Error("World-map envelope length or alignment is invalid.");
	const header: unknown = JSON.parse(
		new TextDecoder().decode(bytes.subarray(12, base)),
	);
	return { header, data: bytes.subarray(base) };
}

/** Decode one bounded sequential response, including completion after the final save wait. */
export function decodeWorldMapTiles(
	input: Uint8Array,
	manifest: WorldMapManifest,
	nextTile: number,
): WorldMapTileBatch {
	if (
		!Number.isInteger(nextTile) ||
		nextTile < 0 ||
		nextTile > manifest.tiles.length
	)
		throw new Error("World-map tile cursor is out of range.");
	const decoded = envelope(input, "HBWT");
	const header = batchSchema.parse(decoded.header);
	if (header.receiptId !== manifest.receiptId)
		throw new Error("World-map receipt identity mismatch.");
	if (header.firstTile !== nextTile)
		throw new Error(
			"World-map tile response does not match the requested cursor.",
		);
	const end = nextTile + header.tileCount;
	if (end > manifest.tiles.length)
		throw new Error("World-map tile response exceeds the image partition.");
	if (header.state === "complete" && end !== manifest.tiles.length)
		throw new Error("World-map completion arrived before all image tiles.");
	if (header.state === "streaming" && header.tileCount === 0)
		throw new Error("World-map streaming response made no progress.");
	const tileBytes = WORLD_MAP_TILE_SIDE ** 2 * 4;
	if (decoded.data.length !== header.tileCount * tileBytes)
		throw new Error("World-map RGBA tile payload length is invalid.");
	// ImageData requires ArrayBuffer-backed clamped bytes; each copy is bounded to one 64 KiB tile.
	const tiles = Array.from(
		{ length: header.tileCount },
		(_, index) =>
			new Uint8ClampedArray(
				decoded.data.subarray(index * tileBytes, (index + 1) * tileBytes),
			),
	);
	return { firstTile: header.firstTile, state: header.state, tiles };
}
