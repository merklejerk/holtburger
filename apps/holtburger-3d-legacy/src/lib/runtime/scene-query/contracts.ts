import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	EnvCellStaticObjectPlacementRecord,
	StaticBounds,
	StaticObjectInstanceFacts,
	StaticObjectMaterialSourceFacts,
	StaticObjectPartSourceFacts,
	StaticObjectTextureRefFacts,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
	TerrainMeshQuadFacts,
} from "../../static/contracts";

/** Render-space 3D vector used by scene-query contracts. */
export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** Render-space ray used by static scene picking. */
export interface StaticSceneRay {
	readonly origin: Vec3;
	readonly direction: Vec3;
}

export type StaticScenePickContext =
	| {
			readonly kind: "outdoor";
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly acceptedEnvCellIds?: readonly number[];
	  };

export interface StaticScenePickRequest {
	readonly context: StaticScenePickContext;
	readonly ray: StaticSceneRay;
	readonly filters?: StaticScenePickFilters;
}

/** Caller-owned static pick filters. Query membership does not imply browser selection. */
export interface StaticScenePickFilters {
	readonly itemKinds?: readonly StaticSceneSelectionKey["itemKind"][];
	readonly domains?: readonly StaticSceneSelectionKey["domain"][];
	/** Includes debug-only env-cell portal aperture triangles in static ray picking. */
	readonly includeEnvCellPortals?: boolean;
	readonly ignoreContainingOrigin?: boolean;
}

export type StaticScenePickHit =
	| OutdoorStaticObjectScenePickHit
	| EnvCellStaticScenePickHit
	| EnvCellPortalScenePickHit
	| TerrainQuadScenePickHit;

export type StaticSceneSelectionKey =
	| OutdoorStaticObjectSceneSelectionKey
	| EnvCellStaticSceneSelectionKey
	| EnvCellPortalSceneSelectionKey
	| TerrainQuadSceneSelectionKey;

export interface OutdoorStaticObjectSceneSelectionKey {
	readonly itemKind: "outdoor-static-object";
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly instanceId: string;
}

export interface EnvCellStaticSceneSelectionKey {
	readonly itemKind: "env-cell-static-object";
	readonly domain: "env-cell-system";
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}

export interface EnvCellPortalSceneSelectionKey {
	readonly itemKind: "env-cell-portal";
	readonly domain: "env-cell-system";
	readonly landblockId: number;
	readonly envCellId: number;
	readonly portalId: string;
}

export interface TerrainQuadSceneSelectionKey {
	readonly itemKind: "terrain-quad";
	readonly domain: "outdoor-terrain";
	readonly landblockId: number;
	readonly quadIndex: number;
}

export interface OutdoorStaticObjectScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: OutdoorStaticObjectSceneSelectionKey;
}

export interface EnvCellStaticScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: EnvCellStaticSceneSelectionKey;
}

export interface EnvCellPortalScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: EnvCellPortalSceneSelectionKey;
}

export interface TerrainQuadScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: TerrainQuadSceneSelectionKey;
}

export interface OutdoorStaticObjectScenePickDetails {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly instanceId: string;
	readonly object: StaticObjectInstanceFacts;
	readonly bvhItemIndex: number;
	readonly bvhItemKind: "static" | "building";
}

export interface OutdoorStaticObjectSourceDiagnostics {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly materialSlots: readonly OutdoorStaticObjectMaterialSlotDiagnostics[];
	readonly object: StaticObjectInstanceFacts;
	readonly sourceAsset: OutdoorStaticObjectSourceAssetDiagnostics | null;
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}

export type OutdoorStaticObjectPartDiagnostics = Omit<
	StaticObjectPartSourceFacts,
	"normals" | "positions" | "texCoords" | "triangles"
>;

export type OutdoorStaticObjectSourceAssetDiagnostics = Omit<
	OutdoorStaticObjectsScopePayload["sourceAssets"][number],
	"parts"
> & {
	readonly parts: readonly OutdoorStaticObjectPartDiagnostics[];
};

export interface OutdoorStaticObjectMaterialSlotDiagnostics {
	readonly material: StaticObjectMaterialSourceFacts | null;
	readonly slot: OutdoorStaticObjectsScopePayload["materialSlots"][number];
}

export interface EnvCellStaticScenePickDetails {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly placement: EnvCellSystemStaticScopePayload["envCells"][number]["staticObjectPlacements"][number];
}

export interface TerrainQuadScenePickDetails {
	readonly landblockId: number;
	readonly quad: TerrainMeshQuadFacts;
	readonly bvhItemIndex: number;
}

export interface EnvCellPortalScenePickDetails {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly portal:
		StaticPortalInteriorRecord["envCells"][number]["portals"][number] | null;
	readonly portalAperture: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];
}

export interface StaticSceneSelectionDebugBounds {
	readonly bounds: StaticBounds;
	readonly selectionKey: StaticSceneSelectionKey;
}

export interface StaticSceneEnvCellBounds {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly landblockId: number;
}

export interface StaticSceneTerrainLandblockBounds {
	readonly bounds: StaticBounds;
	readonly landblockId: number;
}

export interface StaticSceneEnvCellAabbDebugBounds {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly landblockId: number;
	readonly memberId: string;
	readonly source: "env-cell-root" | "derived";
}

export interface StaticSceneQuerySnapshot {
	readonly landblockBucketCount: number;
	readonly terrainLandblockCount: number;
	readonly terrainRecordCount: number;
	readonly outdoorRecordCount: number;
	readonly envCellRecordCount: number;
	readonly envCellLandblockCount: number;
	readonly committedEnvCellLandblockCount: number;
	readonly committedEnvCellPortalGraphRecordCount: number;
	readonly committedEnvCellPortalInteriorRecordCount: number;
	readonly committedEnvCellSourceMappingRecordCount: number;
	readonly committedEnvCellSpatialRecordCount: number;
	readonly committedEnvCellVisibilityRecordCount: number;
	readonly envCellResidencyBspAcceptedCandidateCount: number;
	readonly envCellResidencyBspFallbackCount: number;
	readonly envCellResidencyBspTestedCandidateCount: number;
	readonly envCellResidencyCoarseCandidateCount: number;
}

export interface StaticSceneQueryOverviewSnapshot {
	/** Outdoor static/query records shown in the browser debug panel. */
	readonly outdoorRecordCount: number;
	/** Env-cell static/query records shown in the browser debug panel. */
	readonly envCellRecordCount: number;
	/** Env-cell landblocks with committed query roots. */
	readonly envCellLandblockCount: number;
}

export interface RetainedOutdoorSourceLandblock {
	readonly landblockId: number;
	readonly domains: {
		readonly terrain: boolean;
		readonly buildings: boolean;
		readonly detail: boolean;
		readonly envCells: boolean;
	};
}

export interface StaticSceneQuerySourcePayloadOptions {
	readonly outdoorAnchorLandblockId?: number | null;
}

export type StaticSceneCameraResidency =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  }
	| {
			readonly kind: "unknown";
			readonly landblockId: number | null;
	  };

export interface StaticSceneCommittedEnvCellRecords {
	readonly envCellStaticObjectPlacementRecords: readonly EnvCellStaticObjectPlacementRecord[];
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly sourceMappings: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly visibilityRecords: readonly StaticVisibilityRecord[];
}
