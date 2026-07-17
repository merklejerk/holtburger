import { CommitBundleSourceKind, type CommitBundle } from "../commit/types";
import type { LandblockId } from "../game-types";
import { LandblockLayerKind } from "./scene-interest";

/** Stable runtime lifetime identity for a static layer or spawned entity. */
export type OwnerId =
	| `landblock-layer:${LandblockId}/${LandblockLayerKind}`
	| `spawned:${string}`;

/** Return the runtime owner responsible for one static landblock layer. */
export function landblockLayerToOwnerId(
	landblockId: LandblockId,
	layer: LandblockLayerKind,
): OwnerId {
	return `landblock-layer:${landblockId}/${layer}`;
}

/** Return the runtime owner responsible for one independently spawned entity. */
export function spawnedEntityToOwnerId(entityId: string): OwnerId {
	return `spawned:${entityId}`;
}

/** Resolve the runtime lifetime owner for one committed artifact. */
export function commitBundleOwnerId(artifact: CommitBundle): OwnerId {
	return artifact.kind === CommitBundleSourceKind.LandblockLayer
		? landblockLayerToOwnerId(artifact.landblockId, artifact.layer)
		: spawnedEntityToOwnerId(artifact.id);
}
