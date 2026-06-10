export type StaticDomain = "terrain" | "buildings" | "detail" | "envCells";

export type StaticScope =
	| {
			readonly kind: "landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface StaticLodRadii {
	readonly terrain: number;
	readonly buildings: number;
	readonly detail: number;
	readonly envCells: number;
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
	readonly policyRevision: number;
}

export interface StaticWorkRequest {
	readonly requestId: string;
	readonly revision: number;
	readonly scope: StaticScope;
	readonly domain: StaticDomain;
	readonly priority: number;
	readonly policyRevision: number;
}

export interface StaticScopePayload {
	readonly request: StaticWorkRequest;
	readonly scope: StaticScopePayloadBody;
	readonly sourceRevision: number;
}

export type StaticScopePayloadBody =
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
export type PreparedTextureMipPolicy = "none" | "retail4";
export type PreparedTextureColorSpace = "srgb" | "data" | "linear" | "source";

export interface PreparedTextureUseIdentity {
	readonly kind: "prepared-texture-use";
	readonly renderSurfaceId: number;
	readonly usage: PreparedTextureUsage;
	readonly outputFormat: PreparedTextureOutputFormat;
	readonly mipPolicy: PreparedTextureMipPolicy;
	readonly colorSpace: PreparedTextureColorSpace;
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
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly quadCount: number;
	readonly minHeight: number;
	readonly maxHeight: number;
	readonly bounds: StaticBounds | null;
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
	readonly pcodeEncoding: {
		readonly terrainCodeBits: 5;
		readonly roadCodeBits: 2;
		readonly sizeBitMask: number;
	};
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
	readonly role: "terrain-base" | "terrain-alpha" | "road" | "road-alpha" | "detail";
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

export interface DomainAtlasSnapshot {
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly textureUses: readonly StaticTextureUseIdentity[];
}

export interface StaticBakeInput {
	readonly request: StaticWorkRequest;
	readonly payload: StaticScopePayload;
	readonly atlasSnapshot: DomainAtlasSnapshot;
}

export interface StaticBakeResult {
	readonly request: StaticWorkRequest;
	readonly drawUnitIds: readonly string[];
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly string[];
	readonly staticVisibilityRecords: readonly string[];
	readonly staticPortalInteriorRecords: readonly string[];
	readonly staticSourceMappings: readonly string[];
	readonly staticAuthoredDynamicSeeds: readonly string[];
	readonly buildRevision: number;
}

export interface StaticResolverClient {
	resolve(request: StaticWorkRequest): Promise<StaticScopePayload>;
}

export interface StaticBakerClient {
	bake(input: StaticBakeInput): Promise<StaticBakeResult>;
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
	readonly activeRequests: readonly StaticWorkRequestStatus[];
}

export interface StaticWorkRequestStatus {
	readonly requestId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status: "requested" | "resolving" | "baking" | "committed" | "failed";
}
