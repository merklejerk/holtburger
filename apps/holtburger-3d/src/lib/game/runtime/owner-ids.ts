import type { LandblockId } from "../game-types";
import { LandblockLayerKind } from "./scene-interest";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";

/** Stable runtime lifetime identity for a static layer or spawned entity. */
export type OwnerId =
	| `landblock-layer:${LandblockId}/${LandblockLayerKind}`
	| `spawned:${string}`;

/** Runtime lifetime identity for resource leases owned exclusively by one terrain source. */
export type TerrainResourceOwnerId = `terrain-resource:${LandblockId}`;

/** Runtime lifetime identity for an active-region resource shared by multiple landblock layers. */
export type ActiveRegionResourceOwnerId = `active-region-resource:${string}`;

/** One staged static replacement's private geometry and instance-resource lease owner. */
export type StaticRevisionResourceOwnerId =
	`static-revision:${OwnerId}/${number}`;

/** Any runtime owner admitted by geometry and texture resource managers. */
export type ResourceOwnerId =
	| OwnerId
	| TerrainResourceOwnerId
	| ActiveRegionResourceOwnerId
	| StaticRevisionResourceOwnerId;

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

/** Derive collision-free static resource ownership from the authoritative layer revision. */
export function staticRevisionToResourceOwnerId(
	owner: OwnerId,
	revision: number,
): StaticRevisionResourceOwnerId {
	return `static-revision:${owner}/${revision}`;
}

/** Derive geometry keys from the same authoritative layer owner and revision as their lease. */
export function staticRevisionToInstallNamespace(
	owner: OwnerId,
	revision: number,
): StaticInstallResourceNamespace {
	return `static-install:${owner}/${revision}`;
}
