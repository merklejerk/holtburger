import type {
	LandblockEnvCellsPayloadDto,
	LandblockOutdoorPayloadDto,
	PlacementTransformDto,
} from "../../lib/host/contracts";
import type { VisualGeometryPayload } from "../visual/visual-geometry";

export type StaticDomain =
	| "outdoor-terrain"
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain
	| "outdoor-detail"
	| "landblock-env-cells";

/**
 * Public outdoor object layer domains. Explicit object instances and generated
 * scenery have different LoD ownership even while older resolver plumbing is
 * still being retired.
 */
export type OutdoorStaticObjectLayerDomain =
	| "outdoor-explicit-objects"
	| "outdoor-generated-scenery";

/**
 * Outdoor static-object domains accepted by materialization contracts. The
 * combined detail domain remains only for the old resolver path scheduled for
 * removal in the source-first cutover phases.
 */
export type OutdoorStaticObjectDomain =
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain
	| "outdoor-detail";

/**
 * Runtime-authored object-material texture placement is not a static resolver
 * domain; it only describes renderer atlas ownership/policy.
 */
type RuntimeVisualTextureDomain = "runtime-object-material";

/**
 * Texture atlas placement domain used by renderer/resource policy. Static
 * scenery and runtime visual resources share texture placement machinery, but
 * runtime-only domains must not leak into static resolver/work contracts.
 */
export type VisualTextureDomain = StaticDomain | RuntimeVisualTextureDomain;

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

export interface StaticScopeOwnerKey {
	readonly domain: StaticDomain;
	readonly scope: StaticResolverScope;
	readonly scopeKey: string;
}

export type LayerOwnerKind =
	| "terrain"
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain
	| "env-cell-system";

export interface LayerOwnerKey {
	readonly kind: LayerOwnerKind;
	readonly landblockId: number;
}

export type LayerOwnerLifecycle =
	| "desired"
	| "resolving"
	| "baking"
	| "materialized"
	| "empty"
	| "failed";

export interface LayerOwnerState {
	readonly key: LayerOwnerKey;
	readonly lifecycle: LayerOwnerLifecycle;
	readonly revision: number;
}

export interface StaticDemandPlan {
	readonly retainedScopes: readonly StaticScopeOwnerKey[];
	readonly work: readonly ScheduledStaticWork[];
}

export interface StaticRetentionReconciliation {
	readonly activeWork: readonly ScheduledStaticWork[];
	readonly retainedScopes: readonly StaticScopeOwnerKey[];
	readonly removedResources: readonly StaticResourceKey[];
}

export type StaticResourceKey =
	| StaticDrawUnitResourceKey
	| StaticObjectVisualResourceResourceKey
	| StaticPortalApertureResourceKey;

interface StaticDrawUnitResourceKey {
	readonly kind: "draw-unit";
	readonly drawUnitId: string;
}

interface StaticPortalApertureResourceKey {
	readonly kind: "portal-aperture-resource";
	readonly apertureResourceId: string;
}

interface StaticObjectVisualResourceResourceKey {
	readonly kind: "static-object-visual-resource";
	readonly resourceId: string;
}

export function collectStaticDrawUnitResourceIds(
	resources: readonly StaticResourceKey[],
): readonly string[] {
	return resources.flatMap((resource) =>
		resource.kind === "draw-unit" ? [resource.drawUnitId] : [],
	);
}

export function collectStaticObjectVisualResourceIds(
	resources: readonly StaticResourceKey[],
): readonly string[] {
	return resources.flatMap((resource) =>
		resource.kind === "static-object-visual-resource"
			? [resource.resourceId]
			: [],
	);
}

export type StaticTextureUseOwner =
	/** Texture residency owned by a baked static draw unit. */
	| {
			readonly kind: "draw-unit";
			readonly drawUnitId: string;
	  }
	/** Texture residency owned by reusable static object source geometry. */
	| {
			readonly kind: "static-object-visual-resource";
			readonly resourceId: string;
	  };

function createStaticTextureUseOwnerKey(owner: StaticTextureUseOwner): string {
	return owner.kind === "draw-unit"
		? `draw-unit:${owner.drawUnitId}`
		: `static-object-visual-resource:${owner.resourceId}`;
}

function compareStaticTextureUseOwners(
	left: StaticTextureUseOwner,
	right: StaticTextureUseOwner,
): number {
	return createStaticTextureUseOwnerKey(left).localeCompare(
		createStaticTextureUseOwnerKey(right),
	);
}

export function uniqueSortedStaticTextureUseOwners(
	owners: readonly StaticTextureUseOwner[],
): readonly StaticTextureUseOwner[] {
	const ownersByKey = new Map<string, StaticTextureUseOwner>();
	for (const owner of owners) {
		ownersByKey.set(createStaticTextureUseOwnerKey(owner), owner);
	}
	return [...ownersByKey.values()].sort(compareStaticTextureUseOwners);
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

export interface LandblockSourceIdentity {
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
	readonly domain: OutdoorStaticObjectDomain;
	readonly authoredDynamicSeeds: readonly OutdoorStaticObjectDynamicSeedFacts[];
	readonly buildingTransitionApertures: LandblockOutdoorPayloadDto["buildingTransitionApertures"];
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
	/** Default animation authored by setup-model sources. Direct gfx sources do not carry one. */
	readonly defaultAnimation: number | null;
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
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly materialSlotCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
	readonly invalidPolygonCount: number;
	readonly physicsPolygonCount: number;
	readonly bounds: StaticBounds | null;
	readonly triangles: readonly StaticObjectPartTriangleFacts[];
	readonly defaultPlacements: readonly StaticPlacementTransform[];
	readonly scale: StaticVec3;
	readonly materialSlots: readonly StaticObjectPartMaterialSlotFacts[];
}

export interface StaticObjectSourceGeometryIdentity {
	readonly kind: "static-object-source-geometry";
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly partIndex: number;
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

interface StaticPlacementTransform {
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
	readonly regionRenderProfile: RegionRenderProfileSourceFacts;
	readonly envCells: readonly LandblockEnvCellStaticFacts[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
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
	readonly renderGeometry: LandblockEnvCellRenderGeometryFacts;
	readonly cellBsp: LandblockEnvCellsPayloadDto["envCells"][number]["cellBsp"];
}

type LandblockEnvCellRenderGeometryFacts = Omit<
	LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

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

export interface LandblockPortalLinkFacts {
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
	readonly attachments: StaticBakeBatchAttachments;
	readonly domain: StaticDomain;
	readonly items: readonly StaticBakeBatchItem[];
	readonly revision: number;
	readonly staticBatchId: string;
}

export interface StaticBakeBatchAttachments {
	readonly envCellCellStructureGeometry: readonly EnvCellCellStructureGeometryAttachment[];
	readonly staticObjectSourceGeometry: readonly StaticObjectSourceGeometryAttachment[];
}

export interface EnvCellCellStructureGeometryAttachment {
	readonly identity: EnvCellCellStructureGeometryIdentity;
	readonly sourceId: number;
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly uvs: Float32Array;
	readonly triangles: LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"]["triangles"];
	readonly surfaceIds: readonly number[];
	readonly bounds: StaticBounds | null;
	readonly invalidPolygons: LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"]["invalidPolygons"];
	readonly skippedPolygonCount: number;
}

export interface EnvCellCellStructureGeometryIdentity {
	readonly kind: "env-cell-cell-structure-geometry";
	readonly landblockId: number;
	readonly envCell: EnvCellSourceIdentity;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
}

export interface StaticObjectSourceGeometryAttachment {
	readonly identity: StaticObjectSourceGeometryIdentity;
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
}

export type StaticPeerRecordOwner =
	| StaticDrawUnitPeerRecordOwner
	| StaticWorkPeerRecordOwner;

interface StaticDrawUnitPeerRecordOwner {
	readonly kind: "draw-unit";
	readonly drawUnitId: string;
}

export interface StaticWorkPeerRecordOwner {
	readonly kind: "work";
	readonly workId: string;
	readonly domain: StaticDomain;
	readonly scope: StaticResolverScope;
	readonly scopeKey: string;
}

export type StaticSpatialRecord =
	| StaticDrawUnitSpatialRecord
	| StaticEnvCellStaticObjectSpatialRecord
	| StaticEnvCellSpatialRecord;

interface StaticDrawUnitSpatialRecord {
	readonly kind: "draw-unit-bounds";
	readonly owner: StaticDrawUnitPeerRecordOwner;
	readonly drawUnitId: string;
	readonly triangleCount: number | null;
}

export interface StaticEnvCellStaticObjectSpatialRecord {
	readonly kind: "env-cell-static-object-bounds";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly bounds: StaticBounds;
}

export interface StaticEnvCellSpatialRecord {
	readonly kind: "env-cell-spatial";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly memberId: string;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly cellBsp: LandblockEnvCellStaticFacts["cellBsp"];
	readonly localPlacement: LandblockEnvCellStaticFacts["localPlacement"];
	readonly renderBounds: StaticBounds | null;
	readonly residencyBvh: LandblockEnvCellResidencyBvhFacts;
	readonly residencyBvhNodeCount: number;
	readonly residencyBvhItemCount: number;
}

export type StaticVisibilityRecord = StaticEnvCellVisibilityRecord;

interface StaticEnvCellVisibilityRecord {
	readonly kind: "env-cell-visibility";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly acceptedEnvCellIds: readonly number[];
	readonly visibleLinks: readonly StaticEnvCellVisibleLink[];
	readonly diagnostics: readonly EnvCellVisibilityDiagnostic[];
}

interface StaticEnvCellVisibleLink {
	readonly sourceEnvCellId: number;
	readonly targetEnvCellId: number;
}

export type StaticPortalInteriorRecord = StaticEnvCellPortalInteriorRecord;

export interface StaticPortalGraphRecord {
	readonly kind: "static-portal-graph";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly nodes: readonly StaticPortalGraphNode[];
	readonly edges: readonly StaticPortalGraphEdge[];
}

export interface StaticPortalGraphNode {
	readonly nodeId: string;
	readonly scene: StaticPortalGraphScene;
}

export type StaticPortalGraphScene =
	| {
			readonly kind: "env-cell";
			readonly envCellId: number;
	  }
	| {
			readonly kind: "outdoor";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "landblock-building";
			readonly buildingInstanceId: string;
	  };

export interface StaticPortalGraphEdge {
	readonly edgeId: string;
	readonly sourceNodeId: string;
	readonly targetNodeId: string;
	readonly direction: "directed";
	readonly linkId: string;
	readonly sourceIndex: number;
	readonly flags: number;
	readonly polygonId: number | null;
	readonly provenance: StaticPortalGraphEdgeProvenance;
	readonly sceneCrossing: StaticPortalGraphSceneCrossing | null;
}

export interface StaticPortalProjectionRecord {
	readonly kind: "portal-projection";
	readonly landblockId: number;
	readonly sourceRevisionKey: string;
	readonly root: StaticPortalProjectionRoot;
	readonly rootNodeId: string;
	readonly nodes: readonly StaticPortalProjectionNode[];
	readonly edges: readonly StaticPortalProjectionEdge[];
	readonly outdoorSceneCrossings: readonly StaticPortalProjectionOutdoorSceneCrossing[];
	readonly adjacency: readonly StaticPortalProjectionAdjacency[];
	readonly incomingEdges: readonly StaticPortalProjectionIncomingEdges[];
	readonly components: readonly StaticPortalProjectionComponent[];
	readonly componentEdges: readonly StaticPortalProjectionComponentEdge[];
	readonly renderLayers: readonly StaticPortalProjectionRenderLayer[];
	readonly renderLayerByEnvCellId: readonly StaticPortalProjectionEnvCellLayer[];
	readonly diagnostics: StaticPortalProjectionDiagnostics;
}

export type StaticPortalProjectionRoot =
	| {
			readonly kind: "outdoor-root";
			readonly landblockId: number;
			readonly rootNodeId: string;
	  }
	| {
			readonly kind: "env-cell-root";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly rootNodeId: string;
	  };

interface StaticPortalProjectionNode {
	readonly nodeId: string;
	readonly envCellId: number;
}

export interface StaticPortalProjectionEdge {
	readonly edgeId: string;
	readonly sourceNodeId: string;
	readonly targetNodeId: string;
	readonly sourceEnvCellId: number | null;
	readonly targetEnvCellId: number;
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly linkId: string;
	readonly sourceKind: PortalApertureResourceSourceKind;
	readonly provenance: StaticPortalProjectionEdgeProvenance;
}

type StaticPortalProjectionEdgeProvenance =
	| {
			readonly kind: "building-transition";
			readonly apertureResourceId: string;
			readonly portalId: string;
			readonly buildingInstanceId: string;
			readonly buildingPortalId: string;
			readonly targetEnvCellId: number;
	  }
	| {
			readonly kind: "env-cell-portal";
			readonly sourceEnvCellId: number;
			readonly sourcePortalId: string;
			readonly targetEnvCellId: number;
			readonly targetPortalId: string;
			readonly sourceIndex: number;
			readonly polygonId: number | null;
	  };

export interface StaticPortalProjectionOutdoorSceneCrossing {
	readonly crossingId: string;
	readonly targetEnvCellId: number;
	readonly outdoorLandblockId: number;
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly linkId: string;
	readonly provenance: {
		readonly kind: "building-transition";
		readonly apertureResourceId: string;
		readonly portalId: string;
		readonly buildingInstanceId: string;
		readonly buildingPortalId: string;
		readonly targetEnvCellId: number;
	};
}

export interface StaticPortalProjectionAdjacency {
	readonly sourceNodeId: string;
	readonly edgeIds: readonly string[];
}

export interface StaticPortalProjectionIncomingEdges {
	readonly targetEnvCellId: number;
	readonly edgeIds: readonly string[];
}

export interface StaticPortalProjectionComponent {
	readonly componentId: string;
	readonly envCellIds: readonly number[];
	readonly cyclic: boolean;
	readonly renderLayer: number | null;
}

export interface StaticPortalProjectionComponentEdge {
	readonly sourceComponentId: string;
	readonly targetComponentId: string;
	readonly edgeIds: readonly string[];
}

export interface StaticPortalProjectionRenderLayer {
	readonly renderLayer: number;
	readonly componentIds: readonly string[];
	readonly envCellIds: readonly number[];
}

interface StaticPortalProjectionEnvCellLayer {
	readonly envCellId: number;
	readonly renderLayer: number;
}

export interface StaticPortalProjectionDiagnostics {
	readonly outsideVisibleEnvCellCount: number;
	readonly componentCount: number;
	readonly cyclicComponentCount: number;
	readonly maxRenderLayer: number;
	readonly transitionRootCandidateCount: number;
	readonly acceptedTransitionRootCount: number;
	readonly envCellPortalEdgesRetained: number;
	readonly envCellPortalEdgesRejectedTargetNotOutsideVisible: number;
	readonly envCellPortalEdgesRejectedSourceNotOutsideVisible: number;
	readonly envCellPortalEdgesRejectedMissingAperture: number;
	readonly outboundOutdoorCrossingCandidateCount: number;
	readonly outboundOutdoorCrossingRetainedCount: number;
	readonly outboundOutdoorCrossingSkippedUnreachableTarget: number;
	readonly componentInternalEdgeCount: number;
}

type StaticPortalGraphEdgeProvenance =
	| {
			readonly kind: "env-cell-portal";
			readonly sourceEnvCellId: number;
			readonly sourcePortalId: string;
			readonly target: PortalEndpointIdentity;
	  }
	| {
			readonly kind: "building-transition";
			readonly apertureResourceId: string;
			readonly portalId: string;
			readonly buildingInstanceId: string;
			readonly buildingPortalId: string;
			readonly targetEnvCellId: number;
	  };

type StaticPortalGraphSceneCrossing =
	| {
			readonly kind: "outdoor-to-env-cell";
			readonly outdoorLandblockId: number;
			readonly envCellId: number;
	  }
	| {
			readonly kind: "env-cell-to-env-cell";
			readonly sourceEnvCellId: number;
			readonly targetEnvCellId: number;
	  }
	| {
			readonly kind: "env-cell-to-outdoor";
			readonly sourceEnvCellId: number;
			readonly outdoorLandblockId: number;
	  }
	| {
			readonly kind: "env-cell-to-landblock-building";
			readonly sourceEnvCellId: number;
			readonly buildingInstanceId: string;
	  };

interface StaticEnvCellPortalInteriorRecord {
	readonly kind: "env-cell-portal-interior";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
	readonly envCells: readonly StaticEnvCellPortalSummary[];
}

interface StaticEnvCellPortalSummary {
	readonly envCellId: number;
	readonly localPlacement: LandblockEnvCellStaticFacts["localPlacement"];
	readonly seenOutside: LandblockEnvCellStaticFacts["seenOutside"];
	readonly portals: LandblockEnvCellStaticFacts["portals"];
	readonly portalApertures: LandblockEnvCellStaticFacts["portalApertures"];
}

export type StaticSourceMappingRecord =
	| StaticTerrainSourceTriangleMappingRecord
	| StaticEnvCellSourceMappingRecord;

interface StaticTerrainSourceTriangleMappingRecord {
	readonly kind: "terrain-source-triangle";
	readonly owner: StaticDrawUnitPeerRecordOwner;
	readonly drawUnitId: string;
	readonly sourceTriangleId: string;
}

interface StaticEnvCellSourceMappingRecord {
	readonly kind: "env-cell-source";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly memberId: string;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly surfaces: readonly LandblockEnvCellSurfaceFacts[];
}

export type StaticAuthoredDynamicSeedRecord =
	| OutdoorStaticObjectDynamicSeedRecord
	| StaticEnvCellStaticObjectDynamicSeedRecord
	| StaticEnvCellStaticObjectSeedRecord;

interface OutdoorStaticObjectDynamicSeedRecord {
	readonly kind: "outdoor-static-object-dynamic-seed";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly seed: OutdoorStaticObjectDynamicSeedFacts;
}

export interface OutdoorStaticObjectDynamicSeedFacts {
	readonly landblockId: number;
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly sourceAssetId: string;
	readonly setupModelId: number;
	readonly defaultAnimationId: number;
	readonly sourceResidence: LandblockSourceIdentity;
	readonly localPlacement: StaticPlacementTransform;
	readonly sourceScale: StaticVec3;
	readonly classificationReason: "setup-default-animation";
}

/** Classified env-cell authored static that should enter dynamic runtime registration. */
interface StaticEnvCellStaticObjectDynamicSeedRecord {
	readonly kind: "env-cell-static-object-dynamic-seed";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly seed: EnvCellStaticObjectDynamicSeedFacts;
}

/** Lossless env-cell counterpart to outdoor static-authored dynamic seed facts. */
export interface EnvCellStaticObjectDynamicSeedFacts {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly sourceAssetId: string;
	readonly setupModelId: number;
	readonly defaultAnimationId: number;
	readonly sourceResidence: LandblockSourceIdentity;
	readonly localPlacement: StaticPlacementTransform;
	readonly sourceScale: StaticVec3;
	readonly classificationReason: "setup-default-animation";
}

interface StaticEnvCellStaticObjectSeedRecord {
	readonly kind: "env-cell-static-object-seed";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly seed: LandblockEnvCellStaticObjectSeedFacts;
}

export interface StaticBakeAttachmentRequest {
	readonly domain: StaticDomain;
	readonly items: readonly StaticBakeBatchItem[];
	readonly revision: number;
	readonly staticBatchId: string;
}

export interface StaticBakeAttachmentProvider {
	createAttachments(
		request: StaticBakeAttachmentRequest,
	): Promise<StaticBakeBatchAttachments>;
}

export interface StaticBakeBatchResult {
	readonly staticBatchId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly works: readonly ScheduledStaticWork[];
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly staticObjectBakeDiagnostics: readonly StaticObjectBakeDiagnostics[];
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
	readonly buildRevision: number;
}

export interface StaticObjectBakeDiagnostics {
	readonly kind: "static-object-bake-diagnostics";
	readonly staticBatchId: string;
	readonly domain: Extract<
		StaticDomain,
		OutdoorStaticObjectDomain | "landblock-env-cells"
	>;
	readonly landblockId: number;
	readonly objectCount: number;
	readonly generatedInstanceCount: number;
	readonly authoredDynamicSeedCount: number;
	readonly authoredDynamicSeedClassificationReasons: StaticObjectDynamicSeedClassificationReasonCounts;
	readonly explicitObjectCount: number;
	readonly buildingObjectCount: number;
	readonly uniqueSourceCount: number;
	readonly uniqueSourcePartGeometryCount: number;
	readonly uniqueSourceTriangleCount: number;
	readonly flattenedTriangleCount: number;
	readonly flattenedVertexCount: number;
	readonly drawUnitCount: number;
	readonly partitionCount: number;
	readonly renderablePartitionCount: number;
	readonly skippedPartitionCount: number;
	readonly estimatedFlattenedTypedArrayBytes: number;
	readonly instancedVisualResourceCount: number;
	readonly instancedRenderInstanceCount: number;
	readonly instancedSourceTriangleCount: number;
	readonly estimatedInstancedSourceTypedArrayBytes: number;
	readonly estimatedAvoidedFlattenedTriangleCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly retainedTransparentOutdoorDetailPartitionReasons: StaticObjectRetainedTransparentPartitionReasonCounts;
}

export interface StaticObjectRetainedTransparentPartitionReasonCounts {
	readonly explicitObject: number;
	readonly oneOffGeneratedSource: number;
	readonly repeatedGeneratedSourceRetainedByPartitionPolicy: number;
	readonly missingInstanceBounds: number;
	readonly unsupportedMaterialBucket: number;
	readonly nonRenderableOrDeferredMaterialBucket: number;
}

export interface StaticObjectDynamicSeedClassificationReasonCounts {
	readonly setupDefaultAnimation: number;
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

type StaticMaterialCoverageKind =
	| "env-cell-static-object-seeds"
	| "outdoor-static-objects"
	| "structured-interior"
	| "terrain";

export interface StaticMaterialCoverageReport {
	readonly coverageKey: string;
	readonly coverageKind: StaticMaterialCoverageKind;
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
	| StaticObjectGeometryStaticDrawUnit
	| StructuredInteriorGeometryStaticDrawUnit;

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
	readonly domain:
		| OutdoorStaticObjectDomain
		| "landblock-env-cells";
	readonly ownership: StaticObjectDrawUnitOwnership;
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
	readonly sourceMappingCoverage: readonly StaticObjectSourceMappingCoverage[];
	readonly spatialRecord: StaticSpatialRecord | null;
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly textureUseIds: readonly string[];
	readonly materialIds: readonly number[];
}

export type StaticObjectVisualResourceId = string;

export interface StaticObjectVisualResourceKey {
	readonly kind: "static-object-visual-resource-key";
	/**
	 * Source-local geometry identity. Per-instance placement, landblock residence,
	 * object id, bounds, and current sort bucket do not belong in the reusable key.
	 */
	readonly geometry: StaticObjectSourceGeometryIdentity;
	/**
	 * Material family/pass choose shader and draw-list behavior. Changing either
	 * requires a distinct visual resource even if the source geometry is identical.
	 */
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	/**
	 * Render state affects depth/blend/cull-equivalent behavior and is part of
	 * resource compatibility. Current camera distance and transparent sort bucket
	 * are instance/draw-list state instead.
	 */
	readonly renderState: StaticObjectRenderState;
	/**
	 * Material entries describe the renderer-visible material/texture layout for
	 * every material slot used by the shared geometry.
	 */
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	/**
	 * Index type is a GPU buffer contract. Two otherwise-identical resources with
	 * different index element widths cannot share the same index buffer upload.
	 */
	readonly indexType: StaticObjectGeometryStaticDrawUnit["indexType"];
	/**
	 * Texture use ids are included so renderer texture bindings can move from
	 * draw-unit ownership to visual-resource ownership without hidden side data.
	 */
	readonly textureUseIds: readonly string[];
}

export interface StaticObjectVisualResource extends VisualGeometryPayload {
	readonly kind: "static-object-visual-resource";
	readonly resourceId: StaticObjectVisualResourceId;
	readonly key: StaticObjectVisualResourceKey;
	readonly geometry: StaticObjectSourceGeometryIdentity;
	/**
	 * Source-local geometry copied from the static object source attachment.
	 * Per-instance placement and scale are applied by the render instance.
	 */
	readonly coordinateSpace: "static-object-source-local";
}

export interface StaticObjectRenderInstance {
	readonly kind: "static-object-render-instance";
	readonly instanceId: string;
	readonly resourceId: StaticObjectVisualResourceId;
	readonly domain: OutdoorStaticObjectLayerDomain | "outdoor-detail";
	readonly landblockId: number;
	readonly transform: StaticPlacementTransform;
	/**
	 * Full source-geometry-to-landblock matrix for this object/part. This keeps
	 * source scale and setup part placement out of the shared resource buffers.
	 */
	readonly sourceToLandblockMatrix: Float32Array;
	readonly bounds: StaticBounds;
	readonly sortCenter: StaticVec3;
	readonly transparency: StaticObjectTransparencySubmission;
	readonly source: StaticObjectInstanceIdentity;
	readonly generated: StaticObjectGeneratedFacts | null;
}

type StaticObjectTransparencySubmission =
	| {
			readonly kind: "depth-writing";
	  }
	| {
			readonly kind: "instanced-transparent";
			readonly sortCenter: StaticVec3;
	  }
	| {
			readonly kind: "direct-sorted-transparent";
			readonly sortCenter: StaticVec3;
	  };

export type StaticObjectDrawUnitOwnership =
	| {
			readonly kind: "outdoor-static-objects";
			readonly landblockId: number;
			readonly domain: OutdoorStaticObjectDomain;
	  }
	| {
			readonly kind: "env-cell-static-object-seeds";
			readonly landblockId: number;
			readonly envCellIds: readonly number[];
			readonly seedIdentities: readonly StaticObjectInstanceIdentity[];
	  };

export interface StructuredInteriorGeometryStaticDrawUnit {
	readonly kind: "structured-interior-geometry";
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly domain: "landblock-env-cells";
	readonly envCellId: number;
	readonly memberId: string;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly localPlacement: PlacementTransformDto;
	readonly coordinateSpace: "landblock-render-local";
	readonly materialFamily: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly materialPass: StaticObjectMaterialPass;
	readonly materialBucketKey: string;
	readonly renderState: StaticObjectRenderState;
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly materialPlan: readonly StructuredInteriorMaterialPlanEntry[];
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexType: "uint16" | "uint32";
	readonly vertexCount: number;
	readonly triangleCount: number;
	readonly sourceTriangleIds: readonly string[];
	readonly surfaceIds: readonly number[];
	readonly materialIds: readonly number[];
	readonly textureUseIds: readonly string[];
}

export interface StructuredInteriorMaterialPlanEntry {
	readonly slotId: number;
	readonly surfaceId: number;
	readonly material: StaticMaterialSourceIdentity;
	readonly family:
		| "flat-color"
		| "indexed-paletted"
		| "texture-rgba"
		| "unsupported";
	readonly pass: StaticObjectMaterialPass;
	readonly outcome: StaticMaterialRenderOutcome;
	readonly textureUseIds: readonly string[];
	readonly diagnostics: readonly StructuredInteriorMaterialDiagnostic[];
}

export interface StructuredInteriorMaterialDiagnostic {
	readonly code:
		| "missing-cell-structure-material-source"
		| "missing-render-surface"
		| "missing-palette"
		| "unsupported-surface-flag"
		| "translucent-render-deferred"
		| "detail-overlay-render-deferred"
		| "missing-detail-render-surface";
	readonly message: string;
	readonly material: StaticMaterialSourceIdentity;
	readonly surfaceId: number;
}

export interface StaticObjectSourceMappingCoverage {
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly partIndex: number;
	readonly materialSlot: number;
	readonly materialIds: readonly number[];
	readonly geometrySurfaceIds: readonly number[];
	readonly materialVariantSignatures: readonly (string | null)[];
	readonly polygonCount: number;
	readonly polygonRange: StaticNumericRange | null;
	readonly sourceTriangleCount: number;
}

interface StaticNumericRange {
	readonly max: number;
	readonly min: number;
}

export interface StaticMaterialTableEntry {
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
	readonly owners: readonly StaticTextureUseOwner[];
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
	readonly ownerStates: readonly LayerOwnerState[];
	readonly activeWork: readonly ScheduledStaticWorkStatus[];
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	readonly latestOutdoorStaticObjectsPayload: OutdoorStaticObjectsPayloadSummary | null;
	readonly latestLandblockEnvCellsPayload: LandblockEnvCellsPayloadSummary | null;
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly staticObjectBakeDiagnostics: readonly StaticObjectBakeDiagnostics[];
	readonly recentTiming: readonly StaticCoordinatorTimingDiagnostics[];
}

export interface StaticCoordinatorOverviewSnapshot {
	/** Coordinator revision for browser-facing status summaries. */
	readonly revision: number;
	/** Number of active static work items not yet settled. */
	readonly requested: number;
	/** Number of active work items currently resolving source payloads. */
	readonly resolving: number;
	/** Number of active work items currently baking renderable payloads. */
	readonly baking: number;
	/** Number of static work items committed since coordinator creation. */
	readonly committed: number;
	/** Most recent terrain payload summary for browser diagnostics. */
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	/** Most recent env-cell payload summary for browser diagnostics. */
	readonly latestLandblockEnvCellsPayload: LandblockEnvCellsPayloadSummary | null;
}

export interface StaticCoordinatorTimingDiagnostics {
	readonly kind: "static-coordinator-timing";
	readonly staticBatchId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly itemCount: number;
	readonly resolverMs: number | null;
	readonly attachmentMs: number | null;
	readonly bakeMs: number | null;
	readonly commitMs: number | null;
}

export interface StaticCoordinatorCommitDelta {
	readonly staticBatchId: string;
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly addedPortalApertureResources: readonly StaticPortalApertureResource[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
	readonly revision: number;
}

type PortalApertureResourceSourceKind =
	| "env-cell-portal"
	| "building-transition";

export interface StaticPortalApertureResource {
	readonly kind: "portal-aperture-resource";
	readonly apertureResourceId: string;
	readonly coordinateSpace: "landblock-render-local";
	readonly landblockId: number;
	readonly indices: readonly number[];
	readonly ranges: readonly StaticPortalApertureRange[];
	readonly sourceDomain: StaticDomain;
	readonly vertices: readonly StaticVec3[];
}

export type StaticPortalApertureRange =
	| StaticEnvCellPortalApertureRange
	| StaticBuildingTransitionApertureRange;

interface StaticPortalApertureRangeBase {
	readonly rangeId: string;
	readonly sourceId: string;
	readonly firstIndex: number;
	readonly indexCount: number;
}

interface StaticEnvCellPortalApertureRange extends StaticPortalApertureRangeBase {
	readonly source: StaticEnvCellPortalApertureRangeSource;
	readonly sourceKind: "env-cell-portal";
}

interface StaticEnvCellPortalApertureRangeSource {
	readonly envCellId: number;
	readonly kind: "env-cell-portal";
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}

export interface StaticBuildingTransitionApertureRange extends StaticPortalApertureRangeBase {
	readonly source: StaticBuildingTransitionApertureRangeSource;
	readonly sourceKind: "building-transition";
}

interface StaticBuildingTransitionApertureRangeSource {
	readonly buildingInstanceId: string;
	readonly buildingPortalId: string;
	readonly buildingPortalSourceIndex: number;
	readonly kind: "building-transition";
	readonly linkedEnvCellIds: readonly number[];
	readonly otherCellId: number;
	readonly otherPortalId: number;
	readonly polyId: number;
	readonly portalId: string;
	readonly portalIndex: number;
	readonly sourceAssetId: string;
	readonly sourceDid: number;
	readonly landblockId: number;
	readonly targetEnvCellId: number;
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
