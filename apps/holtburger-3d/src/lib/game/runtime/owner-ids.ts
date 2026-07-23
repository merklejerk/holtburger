import type { LandblockId } from "../game-types";
import { LandblockLayerKind } from "./scene-interest";

/** Stable runtime lifetime identity for a static layer or spawned entity. */
export type OwnerId =
	| `landblock-layer:${LandblockId}/${LandblockLayerKind}`
	| `spawned:${string}`;

/** Runtime lifetime identity for resource leases owned exclusively by one terrain source. */
export type TerrainResourceOwnerId = `terrain-resource:${LandblockId}`;

/** Any runtime owner admitted by geometry and texture resource managers. */
export type ResourceOwnerId = OwnerId | TerrainResourceOwnerId;

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

/** Return the private resource owner for one terrain source installation. */
export function terrainSourceToOwnerId(
	landblockId: LandblockId,
): TerrainResourceOwnerId {
	return `terrain-resource:${landblockId}`;
}
