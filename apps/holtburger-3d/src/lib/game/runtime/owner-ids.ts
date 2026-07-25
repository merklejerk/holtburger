import type { LandblockId } from "../game-types";
import { LandblockLayerKind } from "./scene-interest";

/** Stable runtime lifetime identity for a static layer or spawned entity. */
export type OwnerId =
	| `landblock-layer:${LandblockId}/${LandblockLayerKind}`
	| `spawned:${string}`;

/** Runtime lifetime identity for resource leases owned exclusively by one terrain source. */
export type TerrainResourceOwnerId = `terrain-resource:${LandblockId}`;

/** Runtime lifetime identity for an active-region resource shared by multiple landblock layers. */
export type ActiveRegionResourceOwnerId = `active-region-resource:${string}`;

/** Any runtime owner admitted by geometry and texture resource managers. */
export type ResourceOwnerId =
	| OwnerId
	| TerrainResourceOwnerId
	| ActiveRegionResourceOwnerId;

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

/** Return the private resource owner for one active-region-scoped binding. */
export function activeRegionResourceToOwnerId(
	activeRegionKey: string,
): ActiveRegionResourceOwnerId {
	return `active-region-resource:${activeRegionKey}`;
}
