import type { LandblockOwnerId } from "../game-types";
import { LandblockLayerKind } from "./scene-interest";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { ObjectVisualTemplateResourceOwnerId } from "../systems/object-visual-template-repository";

/** Stable runtime lifetime identity for one authored static layer. */
export type OwnerId =
	`landblock-layer:${LandblockOwnerId}/${LandblockLayerKind}`;

/** Stable frontend lifetime identity for one producer-owned live dynamic entity. */
export type DynamicEntityOwnerId = `dynamic-entity:${number}`;

/** Every owner admitted by the shared dynamic presentation systems. */
export type DynamicOwnerId = OwnerId | DynamicEntityOwnerId;

/** Runtime lifetime identity for resource leases owned exclusively by one terrain source. */
export type TerrainResourceOwnerId = `terrain-resource:${LandblockOwnerId}`;

/** Runtime lifetime identity for an active-region resource shared by multiple landblock layers. */
export type ActiveRegionResourceOwnerId = `active-region-resource:${string}`;

/** One staged static replacement's private geometry and instance-resource lease owner. */
export type StaticRevisionResourceOwnerId =
	`static-revision:${OwnerId}/${number}`;
/** Shell/aperture lease kept separate from resident geometry owned by StaticObjectSystem. */
export type EnvCellRevisionResourceOwnerId =
	`env-cell-revision:${OwnerId}/${number}`;
/** Private geometry lease for one prepared authored-dynamic owner generation. */
export type DynamicGenerationResourceOwnerId =
	`dynamic-generation:${DynamicOwnerId}/${number}`;

/** Stable resource owner for the authored portal transition visual. */
export type PortalTransitionResourceOwnerId = "portal-transition";
export const PORTAL_TRANSITION_RESOURCE_OWNER_ID: PortalTransitionResourceOwnerId =
	"portal-transition";

/** Resource owners admitted by the shared authored-dynamic visual-template repository. */
export type DynamicPresentationResourceOwnerId =
	DynamicGenerationResourceOwnerId | PortalTransitionResourceOwnerId;

/** Any runtime owner admitted by geometry and texture resource managers. */
export type ResourceOwnerId =
	| OwnerId
	| TerrainResourceOwnerId
	| ActiveRegionResourceOwnerId
	| DynamicEntityOwnerId
	| StaticRevisionResourceOwnerId
	| EnvCellRevisionResourceOwnerId
	| DynamicGenerationResourceOwnerId
	| PortalTransitionResourceOwnerId
	| ObjectVisualTemplateResourceOwnerId;

/** Return the runtime owner responsible for one static landblock layer. */
export function landblockLayerToOwnerId(
	landblockId: LandblockOwnerId,
	layer: LandblockLayerKind,
): OwnerId {
	return `landblock-layer:${landblockId}/${layer}`;
}

/** Parse one typed static-layer owner without leaking its string grammar to consumers. */
export function parseLandblockLayerOwnerId(owner: OwnerId): {
	readonly landblockId: LandblockOwnerId;
	readonly layer: LandblockLayerKind;
} {
	const match = /^landblock-layer:(0x[0-9a-f]{8})\/([a-z-]+)$/i.exec(owner);
	if (!match) {
		throw new Error(`Owner ${owner} is not a landblock-layer owner.`);
	}
	const layer = Object.values(LandblockLayerKind).find(
		(candidate) => candidate === match[2],
	);
	if (!layer) {
		throw new Error(`Owner ${owner} has an invalid landblock layer.`);
	}
	return {
		landblockId: match[1]!.toLowerCase() as LandblockOwnerId,
		layer,
	};
}

/** Return the private resource owner for one terrain source installation. */
export function terrainSourceToOwnerId(
	landblockId: LandblockOwnerId,
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

/** Derive the environment-side resource owner for one exact EnvCell revision. */
export function envCellRevisionToResourceOwnerId(
	owner: OwnerId,
	revision: number,
): EnvCellRevisionResourceOwnerId {
	return `env-cell-revision:${owner}/${revision}`;
}

/** Derive collision-free dynamic geometry ownership from the layer owner and generation. */
export function dynamicGenerationToResourceOwnerId(
	owner: DynamicOwnerId,
	generation: number,
): DynamicGenerationResourceOwnerId {
	return `dynamic-generation:${owner}/${generation}`;
}

/** Derive the one stable dynamic-presentation owner for a producer GUID. */
export function dynamicEntityOwnerId(guid: number): DynamicEntityOwnerId {
	return `dynamic-entity:${guid}`;
}

/** Derive geometry keys from the same authoritative layer owner and revision as their lease. */
export function staticRevisionToInstallNamespace(
	owner: OwnerId,
	revision: number,
	partition?: string,
): StaticInstallResourceNamespace {
	return `static-install:${owner}/${revision}${partition ? `/${partition}` : ""}`;
}

/**
 * Lifetime identity for every sky-object script.
 *
 * A single owner rather than one per day group: the sky is region-scoped and its scripts are torn
 * down by the sky runtime's own reconciliation, not by a landblock layer being evicted.
 */
export type SkyOwnerId = "sky-objects";

export const SKY_OWNER_ID: SkyOwnerId = "sky-objects";
