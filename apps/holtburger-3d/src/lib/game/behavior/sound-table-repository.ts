import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type { SoundTableSource } from "../../assets/sound-table-source";
import { PreparedAssetRepository } from "./prepared-asset-repository";

/** Shares immutable sound-table transfer/preparation over the common asset lifecycle. */
export class SoundTableRepository extends PreparedAssetRepository<
	DecodedSoundTable,
	DecodedSoundTable
> {
	constructor(source: SoundTableSource) {
		super({
			destroySource: () => source.destroy(),
			label: "SoundTable",
			load: (soundTableId) => source.loadSoundTable(soundTableId),
			// A decoded table is already immutable and needs no derived facts, so preparation is
			// identity plus the identity check every repository owes.
			prepare: (decoded, expectedId) => {
				if (decoded.id.toLowerCase() !== expectedId.toLowerCase()) {
					throw new Error(
						`Sound table source returned ${decoded.id} for ${expectedId}.`,
					);
				}
				return decoded;
			},
		});
	}
}
