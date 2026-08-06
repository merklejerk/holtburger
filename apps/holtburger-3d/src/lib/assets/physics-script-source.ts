import type { DatAssetId } from "../game/game-types";
import type { DecodedPhysicsScript } from "./decode-physics-script-record";

/** Host adapter boundary for immutable decoded DAT physics scripts. */
export interface PhysicsScriptSource {
	loadPhysicsScript(scriptId: DatAssetId): Promise<DecodedPhysicsScript>;
	destroy(): void;
}
