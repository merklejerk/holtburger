import type { LandblockOwnerId } from "../game/game-types";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
} from "./landblock-source-batch";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for one closed per-landblock source batch. */
export class LandblockSourceHostBatch implements LandblockSourceBatchSource {
	readonly #activeRegion: ActiveRegionSource;
	readonly #transport: HostTransport;

	protected constructor(
		activeRegion: ActiveRegionSource,
		transport: HostTransport,
	) {
		this.#activeRegion = activeRegion;
		this.#transport = transport;
	}

	static build(
		activeRegion: ActiveRegionSource,
		transport: HostTransport,
	): LandblockSourceHostBatch {
		return new LandblockSourceHostBatch(activeRegion, transport);
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockOwnerId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		const response = await this.#transport.invoke(
			"load_landblock_source_batch",
			{
				request: { landblockId, layers: [...layers] },
			},
		);
		return decodeLandblockSourceBatch(
			asHostBinary(response, "Landblock source host command"),
			landblockId,
			layers,
			this.#activeRegion,
		);
	}
}
