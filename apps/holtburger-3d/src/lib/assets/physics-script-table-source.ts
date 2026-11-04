import type { DatAssetId } from "../game/game-types";
import type { DecodedPhysicsScriptTable } from "./decode-physics-script-table-record";

/** Host adapter boundary for immutable decoded DAT PhysicsScriptTables. */
export interface PhysicsScriptTableSource {
	loadPhysicsScriptTable(
		physicsScriptTableId: DatAssetId,
	): Promise<DecodedPhysicsScriptTable>;
	destroy(): void;
}
