import type {
	LandblockEnvCellsPayloadDto,
	LandblockOutdoorPayloadDto,
	PlacementTransformDto,
} from "../../lib/host/contracts";

export type StaticDomain =
	| "outdoor-terrain"
	| "outdoor-buildings"
	| "outdoor-detail"
	| "landblock-env-cells";

export interface StaticResolverScope {
	readonly kind: "landblock";
	readonly landblockId: number;
}

export interface StaticLodRadii {
	readonly terrain: number;
	readonly buildings: number;
	readonly detail: number;
	readonly envCells: number;
}

type StaticDemandLocation =
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

type StaticScopePayloadBody =
	| LandblockEnvCellsStaticScopePayload
	| OutdoorStaticObjectsScopePayload
	| TerrainStaticScopePayload
	| PlaceholderStaticScopePayload;

interface PlaceholderStaticScopePayload {
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
	| StaticObjectInstanceIdentity
	| StaticObjectPartIdentity
	| StaticObjectSourceIdentity
	| StaticMaterialSourceIdentity
	| StaticMaterialSlotIdentity
	| TerrainMaterialIdentity
	| RegionRenderProfileIdentity
	| SurfaceTextureIdentity
	| RenderSurfaceIdentity
	| PaletteIdentity
	| MaterialTextureDataUseIdentity;

interface LandblockSourceIdentity {
	readonly kind: "landblock-source";
	readonly source: "outdoor" | "env-cells";
	readonly landblockId: number;
}

interface EnvCellSourceIdentity {
	readonly kind: "env-cell-source";
	readonly envCellId: number;
}

interface EnvironmentIdentity {
	readonly kind: "environment";
	readonly environmentId: number;
}

interface CellStructureIdentity {
	readonly kind: "cell-structure";
	readonly cellStructureId: number;
}

export interface StaticObjectSourceIdentity {
	readonly kind: "static-object-source";
	readonly sourceAssetKind: "gfx-obj" | "setup-model" | "setup-appearance";
	readonly sourceDid: number;
}

export interface StaticObjectInstanceIdentity {
	readonly kind: "static-object-instance";
	readonly landblockId: number;
	readonly instanceId: string;
	readonly objectKind: "explicit-object" | "building" | "generated-scenery";
}

export interface StaticObjectPartIdentity {
	readonly kind: "static-object-part";
	readonly object: StaticObjectInstanceIdentity;
	readonly partIndex: number;
}

export interface StaticMaterialSourceIdentity {
	readonly kind: "static-material-source";
	readonly materialId: number;
}

export interface StaticMaterialSlotIdentity {
	readonly kind: "static-material-slot";
	readonly part: StaticObjectPartIdentity;
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
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

export interface PaletteIdentity {
	readonly kind: "palette";
	readonly paletteId: number;
}

export interface StaticObjectPaletteViewFacts {
	readonly palette: PaletteIdentity;
	readonly firstIndex: number;
	readonly indexCount: number;
}

export interface StaticObjectPaletteSourceFacts {
	readonly palette: PaletteIdentity;
	readonly colorCount: number;
}

type PreparedRenderSurfaceTextureUsage =
	| "rgba-color"
	| "rgba-detail"
	| "rgba-mask"
	| "rgba-raw"
	| "index8"
	| "index16";

export type PreparedRgbaRenderSurfaceTextureUsage = Extract<
	PreparedRenderSurfaceTextureUsage,
	"rgba-color" | "rgba-detail" | "rgba-mask" | "rgba-raw"
>;

type PreparedIndexRenderSurfaceTextureUsage = Extract<
	PreparedRenderSurfaceTextureUsage,
	"index8" | "index16"
>;

export interface PreparedRenderSurfaceTextureUseIdentity {
	readonly kind: "prepared-render-surface-texture-use";
	readonly renderSurface: RenderSurfaceIdentity;
	readonly usage: PreparedRenderSurfaceTextureUsage;
}

export interface PreparedRgbaRenderSurfaceTextureUseIdentity extends PreparedRenderSurfaceTextureUseIdentity {
	readonly usage: PreparedRgbaRenderSurfaceTextureUsage;
}

export interface PreparedIndexRenderSurfaceTextureUseIdentity extends PreparedRenderSurfaceTextureUseIdentity {
	readonly usage: PreparedIndexRenderSurfaceTextureUsage;
}

interface PaletteTextureUseIdentity {
	readonly kind: "palette-texture-use";
	readonly palette: PaletteIdentity;
	readonly usage: "palette-rgba";
	readonly firstIndex: number;
	readonly indexCount: number;
	readonly subPalettes: readonly StaticObjectPaletteViewFacts[];
}

export type MaterialTextureDataUseIdentity =
	| PreparedRenderSurfaceTextureUseIdentity
	| PaletteTextureUseIdentity;

export type StaticTextureUseIdentity =
	| SurfaceTextureIdentity
	| RenderSurfaceIdentity
	| PaletteIdentity
	| MaterialTextureDataUseIdentity;

type StaticTextureWrapMode = "repeat" | "clamp-to-edge";

export interface StaticBakeTextureSamplingPolicy {
	readonly wrapS: StaticTextureWrapMode;
	readonly wrapT: StaticTextureWrapMode;
}

interface TerrainMeshSourceFacts {
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

interface RegionRenderProfileSourceFacts {
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
	readonly preparedTextureUse: PreparedRgbaRenderSurfaceTextureUseIdentity | null;
	readonly palette: PaletteIdentity | null;
}

export interface TerrainSourceSpatialFacts {
	readonly coordinateSpace: "landblock-render-local";
	readonly bounds: StaticBounds | null;
	readonly terrainBvh: TerrainRenderLocalBvh;
	readonly terrainBvhNodeCount: number;
	readonly terrainBvhItemCount: number;
}

type TerrainHostBvh = LandblockOutdoorPayloadDto["terrain"]["terrainBvh"];

interface TerrainRenderLocalBvh {
	readonly coordinateSpace: "landblock-render-local";
	readonly nodes: readonly TerrainHostBvh["nodes"][number][];
	readonly items: TerrainHostBvh["items"];
}

export interface OutdoorStaticObjectsScopePayload {
	readonly kind: "outdoor-static-objects";
	readonly domain: "outdoor-buildings" | "outdoor-detail";
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: StaticObjectRegionRenderProfileFacts;
	readonly objects: readonly StaticObjectInstanceFacts[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly materialSlots: readonly StaticObjectMaterialSlotFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly sourceSpatial: OutdoorStaticSourceSpatialFacts;
}

interface StaticObjectRegionRenderProfileFacts {
	readonly identity: RegionRenderProfileIdentity;
	readonly detailRoles: readonly RegionDetailRoleFacts[];
}

export interface StaticObjectInstanceFacts {
	readonly identity: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly sourceIndex: number;
	readonly localPlacement: StaticPlacementTransform;
	readonly sourceScale: StaticVec3;
	readonly sourceBounds: StaticBounds | null;
	readonly instanceBounds: StaticBounds | null;
	readonly portalCount: number;
	readonly generated: StaticObjectGeneratedFacts | null;
	readonly debug: StaticObjectDebugProvenance;
}

export interface StaticObjectSourceAssetFacts {
	readonly identity: StaticObjectSourceIdentity;
	readonly sourceAssetKind: StaticObjectSourceIdentity["sourceAssetKind"];
	readonly partCount: number;
	readonly materialSlotCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
	readonly invalidPolygonCount: number;
	readonly physicsPolygonCount: number;
	readonly bounds: StaticBounds | null;
	readonly parts: readonly StaticObjectPartSourceFacts[];
	readonly debug: StaticObjectDebugProvenance;
}

export interface StaticObjectPartSourceFacts {
	readonly partIndex: number;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly materialSlotCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
	readonly invalidPolygonCount: number;
	readonly physicsPolygonCount: number;
	readonly bounds: StaticBounds | null;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly texCoords: Float32Array;
	readonly triangles: readonly StaticObjectPartTriangleFacts[];
	readonly defaultPlacements: readonly StaticPlacementTransform[];
	readonly scale: StaticVec3;
	readonly materialSlots: readonly StaticObjectPartMaterialSlotFacts[];
}

interface StaticObjectPartTriangleFacts {
	readonly polygonId: number;
	readonly geometrySurfaceId: number | null;
	readonly materialVariantSignature: string | null;
	readonly firstVertex: number;
}

export interface StaticObjectPartMaterialSlotFacts {
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: PaletteIdentity | null;
	readonly paletteViews: readonly StaticObjectPaletteViewFacts[];
}

export interface StaticObjectMaterialSlotFacts {
	readonly identity: StaticMaterialSlotIdentity;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: PaletteIdentity | null;
	readonly paletteViews: readonly StaticObjectPaletteViewFacts[];
}

export interface StaticObjectMaterialSourceFacts {
	readonly identity: StaticMaterialSourceIdentity;
	readonly surfaceId: number;
	readonly surfaceType: number;
	readonly source: StaticObjectMaterialSourceKindFacts;
	readonly translucency: number;
	readonly luminosity: number;
	readonly diffuse: number;
}

type StaticObjectMaterialSourceKindFacts =
	| {
			readonly kind: "solid-color";
			readonly argb: number;
	  }
	| {
			readonly kind: "texture";
			readonly texture: SurfaceTextureIdentity;
			readonly selectedRenderSurface: RenderSurfaceIdentity | null;
			readonly palette: PaletteIdentity | null;
			readonly renderSurfaceDefaultPalettes: readonly PaletteIdentity[];
	  };

export type StaticObjectTextureRefFacts =
	| {
			readonly role: "surface-texture";
			readonly texture: SurfaceTextureIdentity;
			readonly renderSurface: RenderSurfaceIdentity | null;
			readonly palette: PaletteIdentity | null;
	  }
	| {
			readonly role: "render-surface";
			readonly renderSurface: RenderSurfaceIdentity;
			readonly width: number;
			readonly height: number;
			readonly format: string;
			readonly formatRaw: number;
			readonly indexedMaxIndex: number | null;
			readonly palette: PaletteIdentity | null;
	  };

interface StaticObjectGeneratedFacts {
	readonly terrainIndex: number;
	readonly sceneId: number;
	readonly sceneTemplateIndex: number;
}

interface OutdoorStaticSourceSpatialFacts {
	readonly coordinateSpace: "landblock-render-local";
	readonly bounds: StaticBounds | null;
	readonly outdoorBvhNodeCount: number;
	readonly outdoorBvhItemCount: number;
	readonly outdoorBvh: OutdoorStaticBvhFacts | null;
}

export interface OutdoorStaticBvhFacts {
	readonly coordinateSpace: "landblock-render-local";
	readonly nodes: NonNullable<
		LandblockOutdoorPayloadDto["outdoorBvh"]
	>["nodes"];
	readonly items: readonly OutdoorStaticBvhItemFacts[];
}

interface OutdoorStaticBvhItemFacts {
	readonly bvhItemIndex: number;
	readonly kind: "static" | "building";
	readonly instanceId: string;
	readonly object: StaticObjectInstanceFacts | null;
}

export interface StaticPlacementTransform {
	readonly origin: StaticVec3;
	readonly orientation: StaticQuaternion;
}

interface StaticQuaternion {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface StaticObjectDebugProvenance {
	readonly sourceAssetId: string;
}

export interface LandblockEnvCellsStaticScopePayload {
	readonly kind: "landblock-env-cells";
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: RegionRenderProfileIdentity;
	readonly envCells: readonly LandblockEnvCellStaticFacts[];
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
	readonly acceptedEnvCellIds: readonly number[];
	readonly visibilityDiagnostics: readonly EnvCellVisibilityDiagnostic[];
	readonly residencySpatial: LandblockEnvCellResidencySpatialFacts;
	readonly missingRefs: readonly StaticResourceIdentity[];
}

export interface LandblockEnvCellStaticFacts {
	readonly identity: EnvCellSourceIdentity;
	readonly landblockId: number;
	readonly memberId: string;
	readonly localPlacement: PlacementTransformDto;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly visibleEnvCellIds: readonly number[];
	readonly restrictionObjectId: number | null;
	readonly seenOutside: boolean | null;
	readonly surfaces: readonly LandblockEnvCellSurfaceFacts[];
	readonly portals: LandblockEnvCellsPayloadDto["envCells"][number]["portals"];
	readonly portalApertures: LandblockEnvCellsPayloadDto["envCells"][number]["portalApertures"];
	readonly staticObjectSeeds: readonly LandblockEnvCellStaticObjectSeedFacts[];
	readonly renderGeometry: LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"];
	readonly cellBsp: LandblockEnvCellsPayloadDto["envCells"][number]["cellBsp"];
	readonly localSpatial: EnvCellSpatialFacts;
}

interface LandblockEnvCellSurfaceFacts {
	readonly slotId: number;
	readonly surfaceId: number;
	readonly material: StaticMaterialSourceIdentity;
}

interface LandblockEnvCellStaticObjectSeedFacts {
	readonly identity: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly sourceIndex: number;
	readonly localPlacement: PlacementTransformDto;
	readonly sourceScale: LandblockEnvCellsPayloadDto["envCells"][number]["statics"][number]["sourceScale"];
	readonly sourceBounds: LandblockEnvCellsPayloadDto["envCells"][number]["statics"][number]["sourceBounds"];
	readonly instanceBounds: LandblockEnvCellsPayloadDto["envCells"][number]["statics"][number]["instanceBounds"];
	readonly debug: StaticObjectDebugProvenance;
}

export interface EnvCellVisibilitySelection {
	readonly acceptedEnvCellIds: readonly number[];
	readonly diagnostics: readonly EnvCellVisibilityDiagnostic[];
}

export type EnvCellVisibilityDiagnostic =
	| {
			readonly kind: "missing-focus-cell";
			readonly envCellId: number;
	  }
	| {
			readonly kind: "missing-visible-cell";
			readonly sourceEnvCellId: number;
			readonly targetEnvCellId: number;
	  }
	| {
			readonly kind: "traversal-cutoff";
			readonly sourceEnvCellId: number;
			readonly targetEnvCellId: number;
			readonly maxDepth: number;
	  };

interface LandblockPortalLinkFacts {
	readonly linkId: string;
	readonly source: PortalEndpointIdentity;
	readonly target: PortalEndpointIdentity;
	readonly flags: number;
	readonly sourceIndex: number;
	readonly polygonId: number | null;
}

type PortalEndpointIdentity =
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

interface LandblockEnvCellResidencySpatialFacts {
	readonly landblockEnvCellBvhNodeCount: number;
	readonly landblockEnvCellBvhItemCount: number;
	readonly landblockEnvCellBvh: LandblockEnvCellResidencyBvhFacts;
}

interface LandblockEnvCellResidencyBvhFacts {
	readonly nodes: LandblockEnvCellsPayloadDto["landblockEnvCellBvh"]["nodes"];
	readonly items: readonly LandblockEnvCellResidencyBvhItemFacts[];
}

interface LandblockEnvCellResidencyBvhItemFacts {
	readonly identity: EnvCellSourceIdentity;
	readonly memberId: string;
	readonly bounds: StaticBounds;
	readonly source: "env-cell-root" | "derived";
}

interface EnvCellSpatialFacts {
	readonly localBvh: LandblockEnvCellsPayloadDto["envCells"][number]["localBvh"];
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
	readonly texture: PreparedRgbaRenderSurfaceTextureUseIdentity;
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
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly string[];
	readonly staticVisibilityRecords: readonly string[];
	readonly staticPortalInteriorRecords: readonly string[];
	readonly staticSourceMappings: readonly string[];
	readonly staticAuthoredDynamicSeeds: readonly string[];
	readonly buildRevision: number;
}

export type StaticMaterialCoverageFamily =
	| "flat-color"
	| "texture-rgba"
	| "indexed-paletted"
	| "unsupported";

export type StaticMaterialCoveragePass =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

export type StaticMaterialRenderOutcome =
	| "rendered"
	| "render-deferred"
	| "unsupported";

export type StaticMaterialCoverageFilteringMode =
	| "none"
	| "shader-palette-linear";

export interface StaticMaterialCoverageReport {
	readonly domain: StaticDomain;
	readonly landblockId: number | null;
	readonly materialCount: number;
	readonly partitionCount: number;
	readonly triangleCount: number;
	readonly renderedTriangleCount: number;
	readonly deferredTriangleCount: number;
	readonly unsupportedTriangleCount: number;
	readonly detailRoleCount: number;
	readonly fallbackReasonCount: number;
	readonly buckets: readonly StaticMaterialCoverageBucket[];
	readonly fallbackReasonCounts: readonly StaticMaterialFallbackReasonCount[];
	readonly unrenderedBuckets: readonly StaticMaterialUnrenderedBucket[];
}

export interface StaticMaterialCoverageBucket {
	readonly family: StaticMaterialCoverageFamily;
	readonly pass: StaticMaterialCoveragePass;
	readonly outcome: StaticMaterialRenderOutcome;
	readonly filteringMode: StaticMaterialCoverageFilteringMode;
	readonly materialCount: number;
	readonly partitionCount: number;
	readonly triangleCount: number;
	readonly textureRoleCount: number;
}

interface StaticMaterialFallbackReasonCount {
	readonly code: string;
	readonly count: number;
}

export interface StaticMaterialUnrenderedBucket {
	readonly family: StaticMaterialCoverageFamily;
	readonly pass: StaticMaterialCoveragePass;
	readonly outcome: Exclude<StaticMaterialRenderOutcome, "rendered">;
	readonly materialCount: number;
	readonly partitionCount: number;
	readonly triangleCount: number;
	readonly reasonCodes: readonly string[];
}

export type StaticDrawUnit =
	| TerrainGeometryStaticDrawUnit
	| StaticObjectGeometryStaticDrawUnit;

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

export interface StaticObjectGeometryStaticDrawUnit {
	readonly kind: "static-object-geometry";
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly domain: "outdoor-buildings" | "outdoor-detail";
	readonly materialFamily: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly materialPass: StaticObjectMaterialPass;
	readonly materialBucketKey: string;
	readonly renderState: StaticObjectRenderState;
	readonly sort: StaticObjectSortMetadata;
	readonly coordinateSpace: "landblock-render-local";
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexType: "uint16" | "uint32";
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly sourceMappingRecords: readonly string[];
	readonly spatialRecord: string | null;
	readonly materialEntries: readonly StaticObjectMaterialTableEntry[];
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly alphaTest: number;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly indexedClipThreshold: number;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly materialColor: readonly [number, number, number, number];
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly materialEmissiveColor: readonly [number, number, number];
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly primaryTextureUseId: string | null;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly indexTextureUseId: string | null;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly indexedTextureFormat: "p8" | "index16" | null;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly paletteTextureUseId: string | null;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly paletteFirstIndex: number;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly detailTextureUseId: string | null;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly detailTextureTiling: number;
	/**
	 * Derived one-entry summary retained while the renderer/test surface cuts over
	 * to materialEntries and materialSlotIndices.
	 */
	readonly primaryTextureWrapMode: "clamp" | "repeat";
	readonly textureUseIds: readonly string[];
	readonly materialIds: readonly number[];
}

export interface StaticObjectMaterialTableEntry {
	readonly slot: number;
	readonly materialIds: readonly number[];
	readonly alphaTest: number;
	readonly indexedClipThreshold: number;
	readonly renderState: StaticObjectRenderState;
	readonly materialColor: readonly [number, number, number, number];
	readonly materialEmissiveColor: readonly [number, number, number];
	readonly primaryTextureUseId: string | null;
	readonly indexTextureUseId: string | null;
	readonly indexedTextureFormat: "p8" | "index16" | null;
	readonly paletteTextureUseId: string | null;
	readonly paletteFirstIndex: number;
	readonly detailTextureUseId: string | null;
	readonly detailTextureTiling: number;
	readonly primaryTextureWrapMode: "clamp" | "repeat";
}

type StaticObjectMaterialPass =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

export interface StaticObjectRenderState {
	readonly blend: StaticObjectBlendState;
	readonly depthTest: true;
	readonly depthWrite: boolean;
}

interface StaticObjectBlendState {
	readonly enabled: boolean;
	readonly mode:
		| "opaque"
		| "clipmap"
		| "translucent"
		| "alpha"
		| "alpha-additive"
		| "inverse-alpha"
		| "inverse-alpha-additive"
		| "additive";
	readonly srcFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
	readonly dstFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
}

export interface StaticObjectSortMetadata {
	readonly policy: "depth-writing" | "object-part-back-to-front";
	readonly objectPartKey: string | null;
	readonly center: readonly [number, number, number];
	readonly bounds: StaticBounds | null;
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

interface TerrainMaterialOverlayBinding {
	readonly terrain: TerrainMaterialTextureRoleBinding;
	readonly alpha: TerrainMaterialTextureRoleBinding;
	readonly rotation: number;
}

interface TerrainMaterialRoadBinding {
	readonly road: TerrainMaterialTextureRoleBinding;
	readonly alpha: TerrainMaterialTextureRoleBinding;
	readonly rotation: number;
}

interface TerrainMaterialDetailRole {
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
	readonly source: MaterialTextureDataUseIdentity;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
}

export interface StaticResolver {
	resolve(job: StaticResolverJob): Promise<StaticScopePayload>;
}

export interface StaticBaker {
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
	readonly latestOutdoorStaticObjectsPayload: OutdoorStaticObjectsPayloadSummary | null;
	readonly latestLandblockEnvCellsPayload: LandblockEnvCellsPayloadSummary | null;
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly latestResolverFailure: StaticResolverFailureSnapshot | null;
}

export interface StaticCoordinatorCommitDelta {
	readonly staticBatchId: string;
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly removedDrawUnitIds: readonly string[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly staticSpatialRecords: readonly string[];
	readonly staticVisibilityRecords: readonly string[];
	readonly staticPortalInteriorRecords: readonly string[];
	readonly staticSourceMappings: readonly string[];
	readonly staticAuthoredDynamicSeeds: readonly string[];
	readonly revision: number;
}

export interface StaticCoordinatorSourcePayloadDelta {
	readonly payload: StaticScopePayload;
	readonly revision: number;
	readonly work: ScheduledStaticWork;
}

export interface ScheduledStaticWorkStatus {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status:
		| "requested"
		| "resolving"
		| "source-committed"
		| "baking"
		| "committed"
		| "failed";
	readonly failureMessage: string | null;
}

export interface LandblockEnvCellsPayloadSummary {
	readonly landblockId: number;
	readonly envCellCount: number;
	readonly acceptedEnvCellCount: number;
	readonly visibleCellCount: number;
	readonly portalCount: number;
	readonly portalLinkCount: number;
	readonly staticObjectSeedCount: number;
	readonly visibilityDiagnosticCount: number;
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

export interface OutdoorStaticObjectsPayloadSummary {
	readonly landblockId: number;
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly objectCount: number;
	readonly objectKindCounts: StaticObjectKindCounts;
	readonly sourceAssetCount: number;
	readonly materialSlotCount: number;
	readonly materialSourceCount: number;
	readonly textureRefCount: number;
	readonly missingRefCount: number;
}

type StaticObjectKindCounts = {
	readonly [K in StaticObjectInstanceIdentity["objectKind"]]: number;
};

export interface StaticResolverFailureSnapshot {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly message: string;
}
