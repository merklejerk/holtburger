import type { PreparedFloat32Array } from "../assets/types";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderBounds } from "./render-spatial-math";

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

export type VirtualTexturePageUsageBucket =
	| "base-color"
	| "detail"
	| "indexed-texels"
	| "palette-lookup"
	| "terrain"
	| "road"
	| "alpha-control";

export type VirtualTexturePageSampleClass =
	| "rgba-color"
	| "indexed-data"
	| "palette-data"
	| "control-data";

type StaticBundleIndexedTextureFormat = "p8" | "index16";

export interface VirtualTexturePageRef {
	key: string;
	sourceAssetId: string;
	usageBucket: VirtualTexturePageUsageBucket;
	sampleClass: VirtualTexturePageSampleClass;
	indexedFormat?: StaticBundleIndexedTextureFormat;
	width: number;
	height: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	samplingDomain: "color" | "data" | "control";
	lookup: "color-filtered" | "exact" | "control-filtered";
	bytes?: Uint8Array;
}

type StaticBundleTexturePageKind = "single-entry" | "packed-atlas";

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
	texturePageRefKeys: readonly string[];
	isTransparent: boolean;
	indexedMaterial?: StaticBundleIndexedMaterialRecord;
}

export interface StaticBundleIndexedMaterialRecord {
	indexFormat: StaticBundleIndexedTextureFormat;
	width: number;
	height: number;
	paletteColorCount: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
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
	partHints?: readonly StaticBundlePartHint[];
}

export interface StaticBundlePartHint {
	renderKey: string;
	partIndex: number;
	gfxObjAssetId?: string;
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
