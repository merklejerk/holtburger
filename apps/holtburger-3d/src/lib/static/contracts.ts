import type {
	LandblockSceneLodLayerDto,
	LandblockSceneLodLevelDto,
	LandblockSceneLodSourceDto,
	PlacementTransformDto,
} from "../../lib/host/contracts";
import type {
	EnvCellSystemLayerSourcePayloadDto,
	LandblockOutdoorLayerSourcePayloadDto,
} from "./source-payloads";
import type {
	DynamicEntityRecipe,
	DynamicVisualBakeResult,
} from "../dynamic/contracts";
import type {
	ObjectVisualTexturePlacementSnapshot,
	TextureResourceDependencies,
	TexturePlacementSnapshot,
} from "../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TextureOwnerId,
	TexturePageClass,
} from "../textures/identity";
import type { ObjectVisualGeometryBuffer } from "../visual/object-visual-recipe-bundle";
import type { ObjectVisualInstallSet } from "../visual/object-visual-install-set";
import type { VisualGeometryPayload } from "../visual/visual-geometry";

export type StaticDomain =
	| "outdoor-terrain"
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain
	| "env-cell-system";

/**
 * Public outdoor object layer domains. Explicit object instances and generated
 * scenery have different LoD ownership even while older resolver plumbing is
 * still being retired.
 */
export type OutdoorStaticObjectLayerDomain =
	| "outdoor-explicit-objects"
	| "outdoor-generated-scenery";

export type OutdoorStaticObjectDomain =
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain;

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
	/** Outdoor explicit-object layer coverage radius. */
	readonly explicitObjects: number;
	/** Outdoor generated-scenery layer coverage radius. */
	readonly generatedScenery: number;
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

type LayerOwnerKind =
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
	| "materializing"
	| "materialized"
	| "empty"
	| "failed";

export interface LayerOwnerState {
	readonly key: LayerOwnerKey;
	readonly lifecycle: LayerOwnerLifecycle;
	readonly revision: number;
}

export interface StaticDemandPlan {
	readonly layerTasks: readonly StaticLayerTaskRequest[];
	readonly retainedLayerOwners: readonly LayerOwnerKey[];
	readonly sourceRequests: readonly StaticLandblockSceneLodSourceRequest[];
}

export interface StaticLayerTaskRequest {
	readonly domain: StaticDomain;
	readonly ownerKey: LayerOwnerKey;
	readonly ownerId: string;
	readonly priority: number;
	readonly revision: number;
	readonly scope: StaticResolverScope;
	readonly scopeKey: string;
	readonly taskId: string;
}

export interface StaticLandblockSceneLodLayerRequest {
	/** LoD layer requested from a landblock scene source payload. */
	readonly kind: LandblockSceneLodLayerDto["kind"];
	/** Layer owner that will receive the emitted recipe after source fanout. */
	readonly targetOwnerKey: LayerOwnerKey;
}

export interface StaticLandblockSceneLodSourceRequest {
	/** Normalized outdoor landblock id used by the `landblock/{id}/lod/{level}` route. */
	readonly landblockId: number;
	/** Scene context passed to the host LoD source assembler. */
	readonly context: LandblockSceneLodSourceDto["context"];
	/** Minimum LoD required to emit every requested layer for this landblock/context. */
	readonly sourceLod: LandblockSceneLodLevelDto;
	/** Layer recipes requested from the prepared source payload. */
	readonly requestedLayers: readonly StaticLandblockSceneLodLayerRequest[];
}

export interface StaticLayerRecipe {
	/** Layer owner that must still be desired before this recipe can be baked. */
	readonly targetOwnerKey: LayerOwnerKey;
	/** Domain-specific payload emitted from source-first resolver fanout. */
	readonly payload: StaticScopePayload;
}

export interface StaticAuthoredDynamicRecipe {
	/** Layer owner whose residency gates activation of the dynamic placement. */
	readonly targetOwnerKey: LayerOwnerKey;
	/** Resolved dynamic visual recipe emitted beside static layer recipes. */
	readonly recipe: DynamicEntityRecipe;
}

export interface StaticLandblockSceneLodResolution {
	readonly dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
	readonly dynamicRecipes: readonly StaticAuthoredDynamicRecipe[];
	readonly request: StaticLandblockSceneLodSourceRequest;
	readonly recipes: readonly StaticLayerRecipe[];
}

export interface StaticLandblockSceneLodSourceProjectionEvent {
	readonly kind: "landblock-scene-lod-source-projected";
	/** Worker-side timing and payload-size facts for the projected runner result. */
	readonly diagnostics: StaticLandblockSceneLodSourceProjectionDiagnostics;
	readonly resolution: StaticLandblockSceneLodResolution;
}

export interface StaticLandblockSceneLodSourceProjectionDiagnostics {
	/** Worker wall-clock timestamp immediately before the projected result is posted to the browser. */
	readonly completedAtEpochMs?: number;
	/** Dynamic placement records delivered to the browser for this runner result. */
	readonly dynamicPlacementCount: number;
	/** Dynamic recipes delivered to the browser for this runner result. */
	readonly dynamicRecipeCount: number;
	/** Static layer recipes delivered to the browser for this runner result. */
	readonly recipeCount: number;
	/** Worker-side milliseconds spent resolving this projected layer result. */
	readonly projectionMs: number;
}

export interface StaticSourceResolutionDiagnostics {
	/** Coordinator-local sequence for source request submission order. */
	readonly requestSeq: number;
	/** Coordinator-local request id for correlating active and recent source work. */
	readonly requestId: string;
	readonly revision: number;
	/** Normalized outdoor landblock id requested from the scene LoD source. */
	readonly landblockId: number;
	/** String form used by browser diagnostics and console reports. */
	readonly landblockHex: string;
	readonly context: StaticLandblockSceneLodSourceRequest["context"];
	readonly sourceLod: StaticLandblockSceneLodSourceRequest["sourceLod"];
	readonly layerKinds: readonly StaticLandblockSceneLodLayerRequest["kind"][];
	readonly taskIds: readonly string[];
	readonly ownerIds: readonly string[];
	readonly status: "pending" | "resolved" | "failed";
	readonly submittedAtMs: number;
	readonly ageMs: number;
	readonly resolverMs: number | null;
	readonly recipeCount: number | null;
	readonly dynamicPlacementCount: number | null;
	readonly dynamicRecipeCount: number | null;
	readonly error: string | null;
}

export interface StaticLandblockSceneLodSourceResolver {
	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution>;
	resolveProjectedSources?(
		request: StaticLandblockSceneLodSourceRequest,
		onProjection: (
			event: StaticLandblockSceneLodSourceProjectionEvent,
		) => void,
	): Promise<void>;
}

export interface StaticRetentionReconciliation {
	/** Reconciliation run that accepted this scene-interest demand. */
	readonly runId: string;
	/** Layer tasks retained or created by the run, keyed by layer owner. */
	readonly layerTasks: readonly StaticLayerTaskStatus[];
	readonly retainedLayerOwners: readonly LayerOwnerKey[];
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

export interface StaticScopePayload {
	readonly job: StaticResolverJob;
	readonly scope: StaticScopePayloadBody;
	readonly sourceRevision: number;
}

type StaticScopePayloadBody =
	| EnvCellSystemStaticScopePayload
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

type PreparedPaletteTextureDomain = "index8" | "index16";

interface PreparedPaletteReplacementIdentity {
	readonly palette: PaletteIdentity;
	readonly offset: number;
	readonly count: number;
}

interface PreparedPaletteTextureUseIdentity {
	readonly kind: "prepared-palette-texture-use";
	readonly palette: PaletteIdentity;
	readonly domain: PreparedPaletteTextureDomain;
	readonly replacements: readonly PreparedPaletteReplacementIdentity[];
	readonly usage: "palette-rgba";
}

export type MaterialTextureDataUseIdentity =
	| PreparedRenderSurfaceTextureUseIdentity
	| PreparedPaletteTextureUseIdentity;

type StaticTextureUseIdentity =
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

interface StaticVec3 {
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

type TerrainHostBvh =
	LandblockOutdoorLayerSourcePayloadDto["terrain"]["terrainBvh"];

interface TerrainRenderLocalBvh {
	readonly coordinateSpace: "landblock-render-local";
	readonly nodes: readonly TerrainHostBvh["nodes"][number][];
	readonly items: TerrainHostBvh["items"];
}

export interface OutdoorStaticObjectsScopePayload {
	readonly kind: "outdoor-static-objects";
	readonly domain: OutdoorStaticObjectDomain;
	/** Static-authored object placements promoted to dynamic visual prep. */
	readonly authoredDynamicPlacements: readonly OutdoorStaticObjectDynamicPlacementFacts[];
	readonly buildingTransitionApertures: LandblockOutdoorLayerSourcePayloadDto["buildingTransitionApertures"];
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
	/** Source-local geometry lookup identity plus canonical raw gfx geometry identity. */
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
	/** Higher-level source asset that authored this part reference. */
	readonly source: StaticObjectSourceIdentity;
	/** Canonical raw gfx geometry payload used by static bake resources. */
	readonly canonical: StaticObjectCanonicalGeometryIdentity;
}

export interface StaticObjectCanonicalGeometryIdentity {
	readonly kind: "static-object-canonical-geometry";
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
		LandblockOutdoorLayerSourcePayloadDto["outdoorBvh"]
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

export interface EnvCellSystemStaticScopePayload {
	readonly kind: "env-cell-system";
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: RegionRenderProfileSourceFacts;
	readonly envCells: readonly LandblockEnvCellStaticFacts[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
	readonly portalConnectivityGraph: EnvCellSystemLayerSourcePayloadDto["portalConnectivityGraph"];
	readonly portalApertureResources: EnvCellSystemLayerSourcePayloadDto["portalApertureResources"];
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
	readonly portals: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["portals"];
	readonly portalApertures: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["portalApertures"];
	/** Static-authored object placements promoted to dynamic visual prep. */
	readonly authoredDynamicPlacements: readonly EnvCellStaticObjectDynamicPlacementFacts[];
	/** Static object placements retained as env-cell bookkeeping, not dynamic activation inputs. */
	readonly staticObjectPlacements: readonly LandblockEnvCellStaticObjectPlacementFacts[];
	readonly renderGeometry: LandblockEnvCellRenderGeometryFacts;
	readonly cellBsp: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["cellBsp"];
}

type LandblockEnvCellRenderGeometryFacts = Omit<
	EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

interface LandblockEnvCellSurfaceFacts {
	readonly slotId: number;
	readonly surfaceId: number;
	readonly material: StaticMaterialSourceIdentity;
}

interface LandblockEnvCellStaticObjectPlacementFacts {
	readonly identity: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly sourceIndex: number;
	readonly localPlacement: PlacementTransformDto;
	readonly sourceScale: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["statics"][number]["sourceScale"];
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
	readonly envCellSystemBvhNodeCount: number;
	readonly envCellSystemBvhItemCount: number;
	readonly envCellSystemBvh: EnvCellSystemResidencyBvhFacts;
}

interface EnvCellSystemResidencyBvhFacts {
	readonly nodes: EnvCellSystemLayerSourcePayloadDto["envCellSystemBvh"]["nodes"];
	readonly items: readonly EnvCellSystemResidencyBvhItemFacts[];
}

interface EnvCellSystemResidencyBvhItemFacts {
	readonly identity: EnvCellSourceIdentity;
	readonly memberId: string;
	readonly bounds: StaticBounds;
	readonly source: "env-cell-root" | "derived";
}

export interface StaticBakeTask {
	/** Opaque async task id used for diagnostics and test harness completion. */
	readonly taskId: string;
	/** Layer owner whose static resources this task produces. */
	readonly ownerKey: LayerOwnerKey;
	/** Stable string form of `ownerKey` for resource ownership and map keys. */
	readonly ownerId: string;
	readonly domain: StaticDomain;
	readonly scope: StaticResolverScope;
	readonly scopeKey: string;
	readonly revision: number;
}

export interface StaticBakeJobPayload {
	/** Task identity that owns the static product baked from this payload. */
	readonly task: StaticBakeTask;
	/** Resolver output for exactly one static layer/domain product. */
	readonly payload: StaticScopePayload;
}

export interface StaticBakeJobInput {
	/** Payload-scoped resources needed to bake this single static job. */
	readonly resources: StaticBakeJobResources;
	readonly domain: StaticDomain;
	readonly task: StaticBakeTask;
	readonly payload: StaticScopePayload;
	/** Pre-bake texture placement assignments available to bakers that can partition by final pages. */
	readonly texturePlacementSnapshot?:
		| TexturePlacementSnapshot
		| ObjectVisualTexturePlacementSnapshot;
	readonly revision: number;
}

export interface StaticBakeJobResources {
	readonly envCellCellStructureGeometry: readonly EnvCellCellStructureGeometrySidecar[];
	readonly staticObjectSourceGeometry: readonly StaticObjectSourceGeometrySidecar[];
}

export interface EnvCellCellStructureGeometrySidecar {
	readonly identity: EnvCellCellStructureGeometryIdentity;
	readonly buffer: ObjectVisualGeometryBuffer;
	readonly sourceId: number;
	readonly surfaceIds: readonly number[];
	readonly invalidPolygons: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"]["invalidPolygons"];
	readonly skippedPolygonCount: number;
}

export interface EnvCellCellStructureGeometryIdentity {
	readonly kind: "env-cell-cell-structure-geometry";
	readonly landblockId: number;
	readonly envCell: EnvCellSourceIdentity;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
}

export interface StaticObjectSourceGeometrySidecar {
	readonly identity: StaticObjectCanonicalGeometryIdentity;
	readonly buffer: ObjectVisualGeometryBuffer;
}

interface StaticDrawUnitPeerRecordOwner {
	readonly kind: "draw-unit";
	readonly drawUnitId: string;
}

export interface StaticLayerPeerRecordOwner {
	readonly kind: "layer-owner";
	readonly key: LayerOwnerKey;
	readonly ownerId: string;
	readonly domain: StaticDomain;
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
	readonly owner: StaticLayerPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly bounds: StaticBounds;
}

export interface StaticEnvCellSpatialRecord {
	readonly kind: "env-cell-spatial";
	readonly owner: StaticLayerPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly memberId: string;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly cellBsp: LandblockEnvCellStaticFacts["cellBsp"];
	readonly localPlacement: LandblockEnvCellStaticFacts["localPlacement"];
	readonly renderBounds: StaticBounds | null;
	readonly residencyBvh: EnvCellSystemResidencyBvhFacts;
	readonly residencyBvhNodeCount: number;
	readonly residencyBvhItemCount: number;
}

export type StaticVisibilityRecord = StaticEnvCellVisibilityRecord;

interface StaticEnvCellVisibilityRecord {
	readonly kind: "env-cell-visibility";
	readonly owner: StaticLayerPeerRecordOwner;
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
	readonly owner: StaticLayerPeerRecordOwner;
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
	readonly owner: StaticLayerPeerRecordOwner;
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
	readonly owner: StaticLayerPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly memberId: string;
	readonly environment: EnvironmentIdentity;
	readonly cellStructure: CellStructureIdentity;
	readonly surfaces: readonly LandblockEnvCellSurfaceFacts[];
}

export type StaticAuthoredDynamicPlacementRecord =
	| OutdoorStaticObjectDynamicPlacementRecord
	| EnvCellStaticObjectDynamicPlacementRecord;

interface OutdoorStaticObjectDynamicPlacementRecord {
	readonly kind: "outdoor-static-object-dynamic-placement";
	readonly owner: StaticLayerPeerRecordOwner;
	readonly placement: OutdoorStaticObjectDynamicPlacementFacts;
}

interface EnvCellStaticObjectDynamicPlacementRecord {
	readonly kind: "env-cell-static-object-dynamic-placement";
	readonly owner: StaticLayerPeerRecordOwner;
	readonly placement: EnvCellStaticObjectDynamicPlacementFacts;
}

export interface OutdoorStaticObjectDynamicPlacementFacts {
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

/** Lossless env-cell counterpart to outdoor static-authored dynamic placement facts. */
export interface EnvCellStaticObjectDynamicPlacementFacts {
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

export interface EnvCellStaticObjectPlacementRecord {
	readonly kind: "env-cell-static-object-placement";
	readonly owner: StaticLayerPeerRecordOwner;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly placement: LandblockEnvCellStaticObjectPlacementFacts;
}

export interface StaticBakeResourceRequest {
	readonly domain: StaticDomain;
	readonly task: StaticBakeTask;
	readonly payload: StaticScopePayload;
	readonly revision: number;
}

export interface StaticBakeResourceProvider {
	createResources(
		request: StaticBakeResourceRequest,
	): Promise<StaticBakeJobResources>;
}

export interface StaticBakeJobResult {
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly task: StaticBakeTask;
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly staticObjectBakeDiagnostics: readonly StaticObjectBakeDiagnostics[];
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly objectVisualInstallSet: ObjectVisualInstallSet;
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly envCellStaticObjectPlacementRecords: readonly EnvCellStaticObjectPlacementRecord[];
	readonly buildRevision: number;
}

export interface StaticObjectBakeDiagnostics {
	readonly kind: "static-object-bake-diagnostics";
	readonly taskId: string;
	readonly domain: Extract<
		StaticDomain,
		OutdoorStaticObjectDomain | "env-cell-system"
	>;
	readonly landblockId: number;
	readonly objectCount: number;
	readonly generatedInstanceCount: number;
	readonly explicitObjectCount: number;
	readonly buildingObjectCount: number;
	readonly uniqueSourceCount: number;
	readonly uniqueSourcePartGeometryCount: number;
	readonly uniqueSourceTriangleCount: number;
	readonly drawUnitCount: number;
	readonly partitionCount: number;
	readonly renderablePartitionCount: number;
	readonly skippedPartitionCount: number;
	readonly instancedVisualResourceCount: number;
	readonly instancedRenderInstanceCount: number;
	readonly instancedSourceTriangleCount: number;
	readonly estimatedInstancedSourceTypedArrayBytes: number;
	readonly estimatedAvoidedFlattenedTriangleCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly retainedTransparentOutdoorGeneratedSceneryPartitionReasons: StaticObjectRetainedTransparentPartitionReasonCounts;
}

export interface StaticObjectRetainedTransparentPartitionReasonCounts {
	readonly explicitObject: number;
	readonly oneOffGeneratedSource: number;
	readonly repeatedGeneratedSourceRetainedByPartitionPolicy: number;
	readonly missingInstanceBounds: number;
	readonly unsupportedMaterialBucket: number;
	readonly nonRenderableOrDeferredMaterialBucket: number;
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
	| "env-cell-static-object-placements"
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
	readonly primaryTextureBindingId: TextureBindingId | null;
	/** Renderer material binding ids used by this draw unit. */
	readonly textureBindingIds: readonly TextureBindingId[];
	readonly terrainMaterialPlan: TerrainMaterialLayerPlan | null;
	readonly terrainFallbackReasons: readonly TerrainMaterialFallbackReason[];
}

export interface StaticObjectGeometryStaticDrawUnit {
	readonly kind: "static-object-geometry";
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly domain: OutdoorStaticObjectDomain | "env-cell-system";
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
	/** Renderer material binding ids used by this draw unit. */
	readonly textureBindingIds: readonly TextureBindingId[];
	readonly materialIds: readonly number[];
}

type StaticObjectVisualResourceId = string;

interface StaticObjectVisualResourceKey {
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
	 * resource batch. Current camera distance and transparent sort bucket
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
}

export interface StaticObjectVisualResource extends VisualGeometryPayload {
	readonly kind: "static-object-visual-resource";
	readonly resourceId: StaticObjectVisualResourceId;
	readonly key: StaticObjectVisualResourceKey;
	readonly geometry: StaticObjectSourceGeometryIdentity;
	/**
	 * Source-local geometry copied from the static object source sidecar.
	 * Per-instance placement and scale are applied by the render instance.
	 */
	readonly coordinateSpace: "static-object-source-local";
}

export interface StaticObjectRenderInstance {
	readonly kind: "static-object-render-instance";
	readonly instanceId: string;
	readonly resourceId: StaticObjectVisualResourceId;
	readonly domain: OutdoorStaticObjectLayerDomain;
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
			readonly kind: "env-cell-static-object-placements";
			readonly landblockId: number;
			readonly envCellIds: readonly number[];
			readonly seedIdentities: readonly StaticObjectInstanceIdentity[];
	  };

export interface StructuredInteriorGeometryStaticDrawUnit {
	readonly kind: "structured-interior-geometry";
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly domain: "env-cell-system";
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
	/** Renderer material binding ids used by this draw unit. */
	readonly textureBindingIds: readonly TextureBindingId[];
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
	/** Renderer material binding ids used by this material plan entry. */
	readonly textureBindingIds: readonly TextureBindingId[];
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
	/** Material binding id for the entry's RGBA base-color texture, if present. */
	readonly primaryTextureBindingId: TextureBindingId | null;
	/** Stable texture identity key for reusable material-resource comparison. */
	readonly primaryTextureKey: string | null;
	/** Material binding id for the entry's indexed color texture, if present. */
	readonly indexTextureBindingId: TextureBindingId | null;
	/** Stable texture identity key for reusable material-resource comparison. */
	readonly indexTextureKey: string | null;
	readonly indexedTextureFormat: "p8" | "index16" | null;
	/** Material binding id for the entry's palette texture, if present. */
	readonly paletteTextureBindingId: TextureBindingId | null;
	/** Stable texture identity key for reusable material-resource comparison. */
	readonly paletteTextureKey: string | null;
	/** Material binding id for the entry's detail overlay texture, if present. */
	readonly detailTextureBindingId: TextureBindingId | null;
	/** Stable texture identity key for reusable material-resource comparison. */
	readonly detailTextureKey: string | null;
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
	readonly textureBindingId: TextureBindingId | null;
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
	/** Material-consumer binding identity. This is not canonical texture-pool identity. */
	readonly bindingId: TextureBindingId;
	readonly domain: StaticDomain;
	/** Canonical texture-pool identity requested by this static texture use. */
	readonly textureKey: TextureKey;
	/** Residency owners that retain the canonical texture entry. */
	readonly ownerIds: readonly TextureOwnerId[];
	readonly owners: readonly StaticTextureUseOwner[];
	/** Physical atlas-page compatibility class for this texture use. */
	readonly pageClass: TexturePageClass;
	readonly source: MaterialTextureDataUseIdentity;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
}

export interface StaticResolver {
	resolve(job: StaticResolverJob): Promise<StaticScopePayload>;
}

export interface StaticBaker {
	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult>;
	createDiagnosticsSnapshot?(): StaticBakerDiagnosticsSnapshot;
}

export interface StaticBakerDiagnosticsSnapshot {
	readonly kind: "static-baker";
	readonly pendingJobs: readonly StaticBakerJobDiagnostics[];
	readonly workerCount: number | null;
}

export type StaticBakerTraceDetails = Readonly<
	Record<string, string | number | boolean | null>
>;

export interface StaticBakerTraceEvent {
	/** Monotonic worker timestamp, in milliseconds, when the trace event was emitted. */
	readonly atMs: number;
	/** Opaque worker substage label used only for pipeline diagnostics. */
	readonly stage: string;
	/** Compact counters and ids that explain the amount of work in this substage. */
	readonly details: StaticBakerTraceDetails;
}

interface StaticBakerJobDiagnostics {
	readonly requestId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly taskId: string;
	readonly scopeKey: string;
	readonly stage: "queued" | "executing";
	readonly ageMs: number;
	readonly stageAgeMs: number;
	readonly queuedAtMs: number;
	readonly stageStartedAtMs: number;
	/** Recent worker-side substages for diagnosing long-running static bake jobs. */
	readonly traceEvents: readonly StaticBakerTraceEvent[];
}

export interface StaticCoordinatorSnapshot {
	readonly revision: number;
	readonly requested: number;
	readonly resolving: number;
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly committedDrawUnits: number;
	readonly ownerStates: readonly LayerOwnerState[];
	readonly layerTasks: readonly StaticLayerTaskStatus[];
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	readonly latestOutdoorStaticObjectsPayload: OutdoorStaticObjectsPayloadSummary | null;
	readonly latestEnvCellSystemPayload: EnvCellSystemPayloadSummary | null;
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly staticObjectBakeDiagnostics: readonly StaticObjectBakeDiagnostics[];
	readonly recentTiming: readonly StaticCoordinatorTimingDiagnostics[];
	readonly staticBakerDiagnostics: StaticBakerDiagnosticsSnapshot | null;
	readonly sourceResolutionDiagnostics: readonly StaticSourceResolutionDiagnostics[];
}

export interface StaticCoordinatorOverviewSnapshot {
	/** Coordinator revision for browser-facing status summaries. */
	readonly revision: number;
	/** Number of active static layer tasks not yet settled. */
	readonly requested: number;
	/** Number of active layer tasks currently resolving source payloads. */
	readonly resolving: number;
	/** Number of active layer tasks currently baking renderable payloads. */
	readonly baking: number;
	/** Number of static layer tasks committed since coordinator creation. */
	readonly committed: number;
	/** Most recent terrain payload summary for browser diagnostics. */
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	/** Most recent env-cell payload summary for browser diagnostics. */
	readonly latestEnvCellSystemPayload: EnvCellSystemPayloadSummary | null;
}

export interface StaticCoordinatorTimingDiagnostics {
	readonly kind: "static-coordinator-timing";
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly taskId: string;
	readonly scopeKey: string;
	readonly resolverMs: number | null;
	readonly placementIntentMs: number | null;
	readonly texturePlacementMs: number | null;
	readonly resourceMs: number | null;
	readonly bakeMs: number | null;
	readonly commitMs: number | null;
}

export interface StaticCoordinatorCommitDelta {
	/** Stable identity for this exact static commit. */
	readonly commitId: string;
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly addedPortalApertureResources: readonly StaticPortalApertureResource[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly objectVisualInstallSet: ObjectVisualInstallSet;
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly envCellStaticObjectPlacementRecords: readonly EnvCellStaticObjectPlacementRecord[];
	/** Static layer tasks whose products are represented by this commit. */
	readonly tasks: readonly StaticBakeTask[];
	readonly revision: number;
}

export interface StaticScopePrepCommit {
	/** Static-only commit payload. */
	readonly staticCommit: StaticCoordinatorCommitDelta;
	/** Static-authored dynamic placements whose residency is gated by this commit. */
	readonly dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
	/** Resolved static-authored dynamic recipes scoped to this commit. */
	readonly dynamicRecipes: readonly DynamicEntityRecipe[];
	/** Baked dynamic visuals produced from sibling source-resolution recipes. */
	readonly dynamicVisualBakeResults: readonly DynamicVisualBakeResult[];
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
	/** Layer task that accepted the resolved source payload. */
	readonly task: StaticLayerTaskStatus;
}

type StaticLayerTaskPhase =
	| "requested"
	| "resolving"
	| "source-resolved"
	| "baking"
	| "committed"
	| "materializing"
	| "materialized"
	| "empty"
	| "failed"
	| "canceled";

export type StaticActiveBakeStage =
	| "source-ready-handler"
	| "resources"
	| "static-baker"
	| "dynamic-visual-baker"
	| "commit-synthesis";

export interface StaticLayerTaskStatus {
	/** Opaque task identifier for diagnostics; layer owner identity remains the semantic key. */
	readonly taskId: string;
	/** Layer owner whose static product is produced by this task. */
	readonly ownerKey: LayerOwnerKey;
	/** Stable string form of `ownerKey` for map keys and compact diagnostics. */
	readonly ownerId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly phase: StaticLayerTaskPhase;
	/** Monotonic timestamp, in milliseconds, when the task entered `phase`. */
	readonly phaseStartedAtMs: number;
	/** Elapsed milliseconds spent in the current phase when this snapshot was created. */
	readonly phaseAgeMs: number;
	/** Current coordinator-side bake stage, for diagnosing long-running active bake closures. */
	readonly activeBakeStage: StaticActiveBakeStage | null;
	/** Monotonic timestamp, in milliseconds, when the active bake stage began. */
	readonly activeBakeStageStartedAtMs: number | null;
	/** Elapsed milliseconds spent in the active bake stage when this snapshot was created. */
	readonly activeBakeStageAgeMs: number | null;
}

export interface EnvCellSystemPayloadSummary {
	readonly landblockId: number;
	readonly envCellCount: number;
	readonly acceptedEnvCellCount: number;
	readonly visibleCellCount: number;
	readonly portalCount: number;
	readonly portalLinkCount: number;
	readonly staticObjectPlacementCount: number;
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
