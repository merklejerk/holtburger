import type { EnvCellId, LandblockId } from "../game-types";
import type { SceneScope } from "./index";

export function scopeFor(
	landblockId: LandblockId,
	envCellId: EnvCellId | null,
): SceneScope {
	return envCellId === null
		? { kind: "outdoor" }
		: { kind: "env-cell", landblockId, envCellId };
}

export function sameScope(left: SceneScope, right: SceneScope): boolean {
	if (left.kind === "outdoor") return right.kind === "outdoor";
	return (
		right.kind === "env-cell" &&
		left.landblockId === right.landblockId &&
		left.envCellId === right.envCellId
	);
}

export function scopeKey(scope: SceneScope): string {
	return scope.kind === "outdoor" ? "outdoor" : scope.envCellId;
}
