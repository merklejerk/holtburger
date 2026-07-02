import type {
	LandblockSourceIdentity,
	OutdoorStaticObjectDomain,
	OutdoorStaticObjectsScopePayload,
	RegionDetailRoleFacts,
	StaticDomain,
} from "../static/contracts";

/** Shared pre-expansion source facts for object-like visual recipe emission. */
export interface ObjectVisualSourcePayload {
	readonly domain: Extract<
		StaticDomain,
		OutdoorStaticObjectDomain | "env-cell-system"
	>;
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
	};
	readonly objects: readonly ObjectVisualSourceObject[];
	readonly sourceAssets: OutdoorStaticObjectsScopePayload["sourceAssets"];
	readonly paletteSources: OutdoorStaticObjectsScopePayload["paletteSources"];
	readonly materialSlots: OutdoorStaticObjectsScopePayload["materialSlots"];
	readonly materialSources: OutdoorStaticObjectsScopePayload["materialSources"];
	readonly textureRefs: OutdoorStaticObjectsScopePayload["textureRefs"];
}

type ObjectVisualSourceObject =
	OutdoorStaticObjectsScopePayload["objects"][number] & {
		readonly owningEnvCellId?: number | null;
	};
