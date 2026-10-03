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

/** Development HTTP adapter exercises the same host contract and binary decoder. */
export function httpWorldMapSource(baseUrl: string): WorldMapSource {
	async function request(path: string, body: unknown): Promise<Response> {
		const response = await fetch(new URL(path, baseUrl), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok)
			throw new Error(
				`World-map host request failed: ${await response.text()}`,
			);
		return response;
	}
	return {
		async open(intent) {
			return decodeWorldMapManifest(
				await (await request("/world-map-open", { intent })).json(),
			);
		},
		async readTiles(manifest, nextTile) {
			return decodeWorldMapTiles(
				new Uint8Array(
					await (
						await request("/world-map-tiles", {
							receiptId: manifest.receiptId,
							nextTile,
						})
					).arrayBuffer(),
				),
				manifest,
				nextTile,
			);
		},
	};
}
