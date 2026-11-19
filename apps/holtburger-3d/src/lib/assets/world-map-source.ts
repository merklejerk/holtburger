import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";
import {
	decodeWorldMapManifest,
	decodeWorldMapTiles,
} from "./decode-world-map";
import type { WorldMapSource } from "../game/world-map/types";

/** Production adapter to the progressive image service; generation has no separate progress poll. */
export function hostWorldMapSource(transport: HostTransport): WorldMapSource {
	return {
		async open(intent) {
			return decodeWorldMapManifest(
				await transport.invoke("open_world_map", { request: { intent } }),
			);
		},
		async readTiles(manifest, nextTile) {
			return decodeWorldMapTiles(
				asHostBinary(
					await transport.invoke("read_world_map_tiles", {
						request: { receiptId: manifest.receiptId, nextTile },
					}),
					"World map",
				),
				manifest,
				nextTile,
			);
		},
	};
}
