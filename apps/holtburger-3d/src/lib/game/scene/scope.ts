import type { EnvCellId, LandblockId } from "../game-types";
import type { SceneScope } from "./index";

export function scopeFor(
	landblockId: LandblockId,
	envCellId: EnvCellId | null,
): SceneScope {
	return envCellId === null
		? { kind: "outdoor", landblockId }
		: { kind: "env-cell", landblockId, envCellId };
}

export function sameScope(left: SceneScope, right: SceneScope): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind === "outdoor") return true;
	return right.kind === "env-cell" && left.envCellId === right.envCellId;
}

export function scopeKey(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? `outdoor:${scope.landblockId}`
		: `env-cell:${scope.landblockId}/${scope.envCellId}`;
}
