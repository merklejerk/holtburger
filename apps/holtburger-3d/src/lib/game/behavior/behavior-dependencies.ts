import type { DatAssetId } from "../game-types";
import type { PreparedBehaviorCommand } from "./prepared-behavior-command";

/** Direct emitter definitions named by animation or physics-script commands, without duplicates. */
export function collectEmitterInfoIds(
	commands: readonly PreparedBehaviorCommand[],
): readonly DatAssetId[] {
	const ids = new Set<DatAssetId>();
	for (const command of commands) {
		if (command.kind === "create-particle") ids.add(command.emitterInfoId);
	}
	return [...ids];
}
