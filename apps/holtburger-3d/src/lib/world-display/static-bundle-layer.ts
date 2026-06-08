import type { PreparedFloat32Array } from "../assets/types";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { IndexedTextureFormat } from "./indexed-material-data";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderBounds } from "./render-spatial-math";
import type {
	TexturePageKind,
	TexturePageLookupPolicy,
	TexturePageSampleClass,
	TexturePageSamplingDomain,
	TexturePageUsageBucket,
	TexturePageWrapMode,
} from "./texture-pages/texture-page-binding";

export type StaticObjectBundleKind =
	| "outdoor-buildings"
	| "outdoor-detail"
	| "env-cell-static";

export type StaticObjectBundleScope =
	| {
			kind: "landblock";
			landblockId: number;
			bundleKind: "outdoor-buildings" | "outdoor-detail";
	  }
	| {
			kind: "env-cell";
			landblockId: number;
			envCellId: number;
			bundleKind: "env-cell-static";
	  };

export type StaticBundleLayerPriority = "resident-now" | "prefetch";

export interface DesiredStaticBundleLayer {
	scope: StaticObjectBundleScope;
	priority: StaticBundleLayerPriority;
	rootAssetIds: readonly string[];
	sourceRevision: string;
	diagnostics: DesiredStaticBundleLayerDiagnostics;
}

interface DesiredStaticBundleLayerDiagnostics {
	knownClosureAssetIds: readonly string[];
	knownMissingAssetIds: readonly string[];
}

export type VirtualTexturePageUsageBucket = TexturePageUsageBucket;

export type VirtualTexturePageSampleClass = TexturePageSampleClass;

export type StaticBundleIndexedTextureFormat = IndexedTextureFormat;

export interface VirtualTexturePageRef {
	key: string;
	sourceAssetId: string;
	usageBucket: VirtualTexturePageUsageBucket;
	sampleClass: VirtualTexturePageSampleClass;
	indexedFormat?: StaticBundleIndexedTextureFormat;
	width: number;
	height: number;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	samplingDomain: TexturePageSamplingDomain;
	lookup: TexturePageLookupPolicy;
	bytes?: Uint8Array;
}

export type StaticBundleTexturePageKind = TexturePageKind;

interface StaticBundleTexturePageEntry {
	virtualRefKey: string;
	sourceAssetId: string;
	rect: readonly [number, number, number, number];
}

export interface StaticBundleTexturePage {
	key: string;
	scopeKey: string;
	pageKind: StaticBundleTexturePageKind;
	usageBucket: VirtualTexturePageUsageBucket;
	sampleClass: VirtualTexturePageSampleClass;
	indexedFormat?: StaticBundleIndexedTextureFormat;
	width: number;
	height: number;
	bytes: Uint8Array;
	entries: readonly StaticBundleTexturePageEntry[];
}

export interface StaticBundleLayerWorkerJob {
	type: "build-static-bundle-layer";
	jobId: string;
	scope: StaticObjectBundleScope;
	rootAssetIds: readonly string[];
	sourceRevision: string;
	buildPolicyRevision: string;
	cpuTexturePagePolicyRevision: string;
}

export interface StaticBundleEnvCellTopologyDiscoveryJob {
	type: "discover-static-env-cell-layer-scopes";
	jobId: string;
	landblockId: number;
	sourceRevision: string;
	buildPolicyRevision: string;
}

interface DiscoveredStaticBundleEnvCellLayerScope {
	scope: Extract<StaticObjectBundleScope, { kind: "env-cell" }>;
	rootAssetIds: readonly string[];
	topologyDependencyAssetIds: readonly string[];
}

export interface StaticBundleEnvCellTopologyDiscoveryResult {
	type: "static-env-cell-layer-scopes-discovered";
	jobId: string;
	landblockId: number;
	sourceRevision: string;
	discoveredScopes: readonly DiscoveredStaticBundleEnvCellLayerScope[];
	diagnostics: {
		envCellCount: number;
		missingAssetIds: readonly string[];
	};
}

export interface StaticBundleLayerWorkerResult {
	type: "static-bundle-layer-built";
	jobId: string;
	scope: StaticObjectBundleScope;
	sourceRevision: string;
	bundleLayer: StaticObjectBundleArtifact;
}

export interface StaticBundleMaterialRecord {
	key: string;
	familyKey: string;
	color: readonly [number, number, number, number];
	texturePageRefKeys: readonly string[];
	detailTextureRefKey: string | null;
	detailTiling: number;
	isTransparent: boolean;
	indexedMaterial?: StaticBundleIndexedMaterialRecord;
}

export interface StaticBundleIndexedMaterialRecord {
	indexFormat: StaticBundleIndexedTextureFormat;
	width: number;
	height: number;
	paletteColorCount: number;
	wrapS: TexturePageWrapMode;
	wrapT: TexturePageWrapMode;
	clipThreshold: number;
}

export interface StaticBundleRenderChunk {
	key: string;
	landblockId: number;
	bounds: RenderBounds | null;
}

export interface StaticBundleCompactedBatch {
	key: string;
	renderChunkKey: string;
	familyKey: string;
	materialRecordKey: string;
	objectKeys: readonly string[];
	objectTriangleCounts: Readonly<Record<string, number>>;
	positions: PreparedFloat32Array;
	normals: PreparedFloat32Array;
	uvs: PreparedFloat32Array;
	indices: Uint16Array | Uint32Array;
}

export interface StaticBundleDirectEntry {
	key: string;
	renderChunkKey: string;
	materialRecordKey: string;
	objectKey: string;
	positions: PreparedFloat32Array;
	normals: PreparedFloat32Array;
	uvs: PreparedFloat32Array;
	indices: Uint16Array | Uint32Array;
	bounds: RenderBounds | null;
}

export interface StaticBundleObjectRecord {
	objectKey: string;
	visibilityKeys: readonly RenderBvhItemKey[];
	sourceAssetId: string;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	kind: "scenery" | "building" | "generated-scenery" | "indoor-static";
	sourceBounds?: RenderBounds | null;
	instanceBounds?: RenderBounds | null;
	localPlacement?: PlacementTransformDto;
	sourceScale?: Vec3Dto;
	partHints?: readonly StaticBundlePartHint[];
}

export interface StaticBundlePartHint {
	renderKey: string;
	partIndex: number;
	gfxObjAssetId?: string;
	materialSlotCount?: number;
	renderMaterialSlotCount?: number;
	sourceRenderTriangleCount?: number;
	sourceSkippedPolygonCount?: number;
	sourceInvalidPolygonCount?: number;
	sourcePhysicsPolygonCount?: number;
	bounds?: RenderBounds;
}

export interface StaticBundleSpatialHint {
	key: string;
	visibilityKeys: readonly RenderBvhItemKey[];
	bounds: RenderBounds;
}

export interface StaticLandblockBundleLayerDiagnostics {
	sourceObjectCount: number;
	compactedSurfaceCount: number;
	directSurfaceCount: number;
	skippedSurfaceCount: number;
	missingAssetIds: readonly string[];
	skippedReasons: readonly string[];
}

export interface StaticObjectBundleArtifact {
	artifactKind: "static-object-bundle";
	key: string;
	scope: StaticObjectBundleScope;
	landblockId: number;
	bundleKind: StaticObjectBundleKind;
	sourceRevision: string;
	rootAssetIds: readonly string[];
	preparedAssetIds: readonly string[];
	renderChunks: readonly StaticBundleRenderChunk[];
	compactedBatches: readonly StaticBundleCompactedBatch[];
	directEntries: readonly StaticBundleDirectEntry[];
	materialRecords: readonly StaticBundleMaterialRecord[];
	texturePageRefs: readonly VirtualTexturePageRef[];
	texturePages: readonly StaticBundleTexturePage[];
	objectRecords: readonly StaticBundleObjectRecord[];
	spatialHints?: readonly StaticBundleSpatialHint[];
	diagnostics: StaticLandblockBundleLayerDiagnostics;
}

export function formatStaticObjectBundleScopeKey(
	scope: StaticObjectBundleScope,
): string {
	if (scope.kind === "landblock") {
		return `landblock:${scope.landblockId}:${scope.bundleKind}`;
	}
	return `env-cell:${scope.landblockId}:${scope.envCellId}:${scope.bundleKind}`;
}
