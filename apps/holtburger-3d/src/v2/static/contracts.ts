export type StaticDomain =
	| "outdoor-terrain"
	| "outdoor-buildings"
	| "outdoor-detail"
	| "landblock-topology"
	| "dungeon-static";

export interface StaticResolverScope {
	readonly kind: "landblock";
	readonly landblockId: number;
}

export interface StaticLodRadii {
	readonly terrain: number;
	readonly buildings: number;
	readonly detail: number;
	readonly topology: number;
}

export type StaticDemandLocation =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "interior-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface StaticDemand {
	readonly location: StaticDemandLocation | null;
	readonly lod: StaticLodRadii;
}

export interface StaticResolverJob {
	readonly scope: StaticResolverScope;
	readonly domain: StaticDomain;
}

export interface ScheduledStaticWork {
	readonly workId: string;
	readonly revision: number;
	readonly job: StaticResolverJob;
	readonly priority: number;
}

export interface StaticScopePayload {
	readonly job: StaticResolverJob;
	readonly scope: StaticScopePayloadBody;
	readonly sourceRevision: number;
}

export type StaticScopePayloadBody =
	| DungeonStaticScopePayload
	| LandblockTopologyStaticScopePayload
	| TerrainStaticScopePayload
	| PlaceholderStaticScopePayload;

export interface PlaceholderStaticScopePayload {
	readonly kind: "placeholder";
	readonly referencedTextureUses: readonly StaticTextureUseIdentity[];
}

export interface TerrainStaticScopePayload {
	readonly kind: "terrain";
	readonly landblock: LandblockSourceIdentity;
	readonly mesh: TerrainMeshSourceFacts;
	readonly terrainMaterial: TerrainMaterialSourceFacts;
	readonly regionRenderProfile: RegionRenderProfileSourceFacts;
	readonly textureUses: readonly TerrainTextureUseFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly sourceSpatial: TerrainSourceSpatialFacts;
}

export type StaticResourceIdentity =
	| CellStructureIdentity
	| EnvCellSourceIdentity
	| EnvironmentIdentity
	| LandblockSourceIdentity
	| TerrainMaterialIdentity
	| RegionRenderProfileIdentity
	| SurfaceTextureIdentity
	| RenderSurfaceIdentity
	| PreparedTextureUseIdentity
	| PaletteIdentity;

export interface LandblockSourceIdentity {
	readonly kind: "landblock-source";
	readonly source: "outdoor" | "topology";
	readonly landblockId: number;
}

export type LandblockClassification = "outdoor" | "dungeon";

export interface EnvCellSourceIdentity {
	readonly kind: "env-cell-source";
	readonly envCellId: number;
}

export interface EnvironmentIdentity {
	readonly kind: "environment";
	readonly environmentId: number;
}

export interface CellStructureIdentity {
	readonly kind: "cell-structure";
	readonly cellStructureId: number;
}

export interface TerrainMaterialIdentity {
	readonly kind: "terrain-material";
	readonly regionNumber: number;
}

export interface RegionRenderProfileIdentity {
	readonly kind: "region-render-profile";
	readonly regionNumber: number;
}

export interface SurfaceTextureIdentity {
	readonly kind: "surface-texture";
	readonly surfaceTextureId: number;
}

export interface RenderSurfaceIdentity {
	readonly kind: "render-surface";
	readonly renderSurfaceId: number;
}

export type PreparedTextureUsage = "color" | "detail" | "mask" | "raw";
export type PreparedTextureOutputFormat = "dxt1" | "dxt3" | "dxt5" | "rgba8";

export interface PreparedTextureUseIdentity {
	readonly kind: "prepared-texture-use";
	readonly renderSurfaceId: number;
	readonly usage: PreparedTextureUsage;
	readonly outputFormat: PreparedTextureOutputFormat;
}

export interface PaletteIdentity {
	readonly kind: "palette";
	readonly paletteId: number;
}

export type StaticTextureUseIdentity =
	| SurfaceTextureIdentity
	| RenderSurfaceIdentity
	| PreparedTextureUseIdentity
	| PaletteIdentity;

export interface TerrainMeshSourceFacts {
	readonly gridSize: number;
	readonly tileSize: number;
	readonly vertices: readonly TerrainMeshVertexFacts[];
	readonly triangles: readonly TerrainMeshTriangleFacts[];
	readonly quads: readonly TerrainMeshQuadFacts[];
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly quadCount: number;
	readonly minHeight: number;
	readonly maxHeight: number;
	readonly bounds: StaticBounds | null;
}

export interface TerrainMeshVertexFacts {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface TerrainMeshTriangleFacts {
	readonly terrainTriangleId: string;
	readonly quadIndex: number;
	readonly triangleInQuad: 0 | 1;
	readonly vertexIndices: readonly [number, number, number];
	readonly averageHeight: number;
	readonly bounds: StaticBounds;
}

export interface TerrainMeshQuadFacts {
	readonly terrainQuadId: string;
	readonly row: number;
	readonly col: number;
	readonly quadIndex: number;
	readonly sourceTerrainIndices: readonly [number, number, number, number];
	readonly vertexIndices: readonly [number, number, number, number];
	readonly triangleIndices: readonly [number, number];
	readonly diagonal: "southwest-northeast" | "southeast-northwest";
	readonly cornerTerrainCodes: readonly [number, number, number, number];
	readonly pcode: number;
	readonly averageHeight: number;
	readonly bounds: StaticBounds;
}

export interface StaticBounds {
	readonly min: StaticVec3;
	readonly max: StaticVec3;
}

export interface StaticVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface TerrainMaterialSourceFacts {
	readonly identity: TerrainMaterialIdentity;
	readonly materialKind: "tex-merge-table";
	readonly terrainTypeCount: number;
	readonly alphaMapCount: number;
	readonly roadAlphaMapCount: number;
	readonly terrainTypes: readonly TerrainMaterialTypeFacts[];
	readonly terrainAlphaMaps: readonly TerrainAlphaMapFacts[];
	readonly roadAlphaMaps: readonly TerrainRoadAlphaMapFacts[];
	readonly pcodeEncoding: {
		readonly terrainCodeBits: 5;
		readonly roadCodeBits: 2;
		readonly sizeBitMask: number;
	};
}

export interface TerrainMaterialTypeFacts {
	readonly terrainCode: number;
	readonly texture: SurfaceTextureIdentity;
	readonly tiling: number;
}

export interface TerrainAlphaMapFacts {
	readonly alphaIndex: number;
	readonly texture: SurfaceTextureIdentity;
	readonly selector: number;
}

export interface TerrainRoadAlphaMapFacts {
	readonly roadIndex: number;
	readonly roadTexture: SurfaceTextureIdentity;
	readonly alphaTexture: SurfaceTextureIdentity;
	readonly selector: number;
}

export interface RegionRenderProfileSourceFacts {
	readonly identity: RegionRenderProfileIdentity;
	readonly detailRoles: readonly RegionDetailRoleFacts[];
}

export interface RegionDetailRoleFacts {
	readonly role: "landscape" | "building" | "environment" | "object";
	readonly texture: SurfaceTextureIdentity;
	readonly tiling: number;
	readonly fadeNear: number;
	readonly fadeFar: number;
}

export interface TerrainTextureUseFacts {
	readonly role:
		| "terrain-base"
		| "terrain-alpha"
		| "road"
		| "road-alpha"
		| "detail";
	readonly texture: SurfaceTextureIdentity;
	readonly renderSurface: RenderSurfaceIdentity | null;
	readonly preparedTextureUse: PreparedTextureUseIdentity | null;
	readonly palette: PaletteIdentity | null;
}

export interface TerrainSourceSpatialFacts {
	readonly coordinateSpace: "landblock-render-local";
	readonly bounds: StaticBounds | null;
	readonly terrainBvhNodeCount: number;
	readonly terrainBvhItemCount: number;
}

export interface LandblockTopologyStaticScopePayload {
	readonly kind: "landblock-topology";
	readonly landblock: LandblockSourceIdentity;
	readonly classification: LandblockClassification;
	readonly envCells: readonly LandblockTopologyEnvCellFacts[];
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
	readonly residencySpatial: LandblockTopologySpatialFacts;
	readonly missingRefs: readonly StaticResourceIdentity[];
}

export interface DungeonStaticScopePayload {
	readonly kind: "dungeon-static";
	readonly landblock: LandblockSourceIdentity;
	readonly classification: "dungeon";
	readonly envCells: readonly EnvCellStaticFacts[];
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
}

export interface LandblockTopologyEnvCellFacts {
	readonly identity: EnvCellSourceIdentity;
	readonly landblockId: number;
	readonly memberId: string;
	readonly visibleEnvCellIds: readonly number[];
	readonly restrictionObjectId: number | null;
	readonly seenOutside: boolean | null;
}

export interface EnvCellStaticFacts {
	readonly identity: EnvCellSourceIdentity;
	readonly landblockId: number;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly visibleEnvCellIds: readonly number[];
	readonly portalCount: number;
	readonly portalApertureCount: number;
	readonly staticObjectSeedCount: number;
	readonly renderGeometryPolygonCount: number;
	readonly localSpatial: EnvCellSpatialFacts;
}

export interface LandblockPortalLinkFacts {
	readonly linkId: string;
	readonly source: PortalEndpointIdentity;
	readonly target: PortalEndpointIdentity;
	readonly flags: number;
	readonly sourceIndex: number;
	readonly polygonId: number | null;
}

export type PortalEndpointIdentity =
	| {
			readonly kind: "landblock-building";
			readonly instanceId: string;
			readonly portalId: string;
	  }
	| {
			readonly kind: "env-cell";
			readonly envCellId: number;
			readonly portalId: string;
	  }
	| {
			readonly kind: "outside";
			readonly landblockId: number;
	  };

export interface LandblockTopologySpatialFacts {
	readonly coordinateSpace: "landblock-topology-residency";
	readonly envCellResidencyBvhNodeCount: number;
	readonly envCellResidencyBvhItemCount: number;
}

export interface EnvCellSpatialFacts {
	readonly coordinateSpace: "env-cell-local";
	readonly localBvhNodeCount: number;
	readonly localBvhItemCount: number;
}

export interface StaticAtlasBatchSnapshot {
	readonly staticBatchId: string;
	readonly domain: StaticDomain;
	readonly textureUses: readonly StaticTextureUseIdentity[];
	readonly placements: readonly StaticAtlasBatchPlacementSnapshot[];
}

interface StaticAtlasBatchPlacementSnapshot {
	readonly texture: PreparedTextureUseIdentity;
}

export interface StaticBakeBatchItem {
	readonly work: ScheduledStaticWork;
	readonly payload: StaticScopePayload;
}

export interface StaticBakeBatchInput {
	readonly atlasSnapshot: StaticAtlasBatchSnapshot;
	readonly domain: StaticDomain;
	readonly items: readonly StaticBakeBatchItem[];
	readonly revision: number;
	readonly staticBatchId: string;
}

export interface StaticBakeBatchResult {
	readonly staticBatchId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly works: readonly ScheduledStaticWork[];
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly string[];
	readonly staticVisibilityRecords: readonly string[];
	readonly staticPortalInteriorRecords: readonly string[];
	readonly staticSourceMappings: readonly string[];
	readonly staticAuthoredDynamicSeeds: readonly string[];
	readonly buildRevision: number;
}

export type StaticDrawUnit =
	| TerrainGeometryStaticDrawUnit
	| PlaceholderStaticDrawUnit;

export interface PlaceholderStaticDrawUnit {
	readonly kind: "placeholder";
	readonly drawUnitId: string;
}

export interface TerrainGeometryStaticDrawUnit {
	readonly kind: "terrain-geometry";
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly domain: "outdoor-terrain";
	readonly materialFamily:
		| "terrain-debug-flat"
		| "terrain-single-base-color"
		| "terrain-layered";
	readonly materialBucketKey: string;
	readonly coordinateSpace: "landblock-render-local";
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly layerSlots: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexType: "uint16" | "uint32";
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly sourceTriangleIds: readonly string[];
	readonly primaryTextureUseId: string | null;
	readonly textureUseIds: readonly string[];
	readonly terrainMaterialPlan: TerrainMaterialLayerPlan | null;
	readonly terrainFallbackReasons: readonly TerrainMaterialFallbackReason[];
}

export interface TerrainMaterialLayerPlan {
	readonly signature: string;
	readonly layerEntries: readonly TerrainMaterialLayerEntry[];
	readonly drawSlices: readonly TerrainMaterialDrawSlice[];
	readonly detailRoles: readonly TerrainMaterialDetailRole[];
	readonly fallbackReasons: readonly TerrainMaterialFallbackReason[];
}

export interface TerrainMaterialLayerEntry {
	readonly slot: number;
	readonly pcode: number;
	readonly base: TerrainMaterialTextureRoleBinding;
	readonly overlays: readonly TerrainMaterialOverlayBinding[];
	readonly roads: readonly TerrainMaterialRoadBinding[];
	readonly allRoad: boolean;
	readonly colorRefCount: number;
	readonly maskRefCount: number;
}

export interface TerrainMaterialTextureRoleBinding {
	readonly role: TerrainTextureUseFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly textureUseId: string | null;
	readonly tiling: number;
	readonly wrap: "repeat" | "clamp";
}

export interface TerrainMaterialOverlayBinding {
	readonly terrain: TerrainMaterialTextureRoleBinding;
	readonly alpha: TerrainMaterialTextureRoleBinding;
	readonly rotation: number;
}

export interface TerrainMaterialRoadBinding {
	readonly road: TerrainMaterialTextureRoleBinding;
	readonly alpha: TerrainMaterialTextureRoleBinding;
	readonly rotation: number;
}

export interface TerrainMaterialDetailRole {
	readonly role: RegionDetailRoleFacts["role"];
	readonly texture: TerrainMaterialTextureRoleBinding;
	readonly fadeNear: number;
	readonly fadeFar: number;
}

export interface TerrainMaterialDrawSlice {
	readonly sliceId: string;
	readonly reason: string;
	readonly layerSlots: readonly number[];
	readonly pcodes: readonly number[];
}

export interface TerrainMaterialFallbackReason {
	readonly code:
		| "missing-terrain-type"
		| "missing-terrain-alpha"
		| "missing-road-alpha"
		| "missing-texture-use"
		| "layer-overflow"
		| "invalid-detail-role"
		| "unsupported-material-binding";
	readonly message: string;
	readonly pcode: number | null;
	readonly texture: SurfaceTextureIdentity | null;
}

export interface StaticBakeTextureUse {
	readonly textureUseId: string;
	readonly staticBatchId: string;
	readonly domain: StaticDomain;
	readonly ownerDrawUnitIds: readonly string[];
	readonly source: PreparedTextureUseIdentity;
}

export interface StaticResolverClient {
	resolve(job: StaticResolverJob): Promise<StaticScopePayload>;
}

export interface StaticBakerClient {
	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult>;
}

export interface StaticCoordinatorSnapshot {
	readonly revision: number;
	readonly requested: number;
	readonly resolving: number;
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly staleResolverResults: number;
	readonly staleBakeResults: number;
	readonly committedDrawUnits: number;
	readonly activeWork: readonly ScheduledStaticWorkStatus[];
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	readonly latestLandblockTopologyPayload: LandblockTopologyPayloadSummary | null;
	readonly latestDungeonPayload: DungeonStaticPayloadSummary | null;
	readonly latestResolverFailure: StaticResolverFailureSnapshot | null;
}

export interface StaticCoordinatorCommitDelta {
	readonly staticBatchId: string;
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly removedDrawUnitIds: readonly string[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly revision: number;
}

export interface ScheduledStaticWorkStatus {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status:
		| "requested"
		| "resolving"
		| "baking"
		| "committed"
		| "failed";
	readonly failureMessage: string | null;
}

export interface LandblockTopologyPayloadSummary {
	readonly landblockId: number;
	readonly classification: LandblockClassification;
	readonly envCellCount: number;
	readonly visibleCellCount: number;
	readonly portalLinkCount: number;
	readonly missingRefCount: number;
}

export interface DungeonStaticPayloadSummary {
	readonly landblockId: number;
	readonly selectedEnvCellId: number | null;
	readonly envCellCount: number;
	readonly visibleCellCount: number;
	readonly portalCount: number;
	readonly missingRefCount: number;
}

export interface TerrainStaticScopePayloadSummary {
	readonly landblockId: number;
	readonly regionNumber: number;
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly quadCount: number;
	readonly textureUseCount: number;
	readonly missingRefCount: number;
}

export interface StaticResolverFailureSnapshot {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly message: string;
}
