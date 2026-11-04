import type { DatAssetId } from "../game/game-types";
import type { DecodedSoundTable } from "./decode-sound-table-record";

/** Host adapter boundary for immutable decoded DAT sound tables. */
export interface SoundTableSource {
	loadSoundTable(soundTableId: DatAssetId): Promise<DecodedSoundTable>;
	destroy(): void;
}
