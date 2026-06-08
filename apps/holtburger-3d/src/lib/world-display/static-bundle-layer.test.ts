import { describe, expect, it } from "vitest";

import type {
	StaticBundleCompactedBatch,
	StaticBundleDirectEntry,
	StaticBundleMaterialRecord,
	StaticBundleObjectRecord,
	StaticBundlePartHint,
	StaticBundleRenderChunk,
	StaticBundleSpatialHint,
	StaticBundleTexturePage,
	StaticBundleLayerWorkerJob,
	StaticBundleEnvCellTopologyDiscoveryJob,
	StaticBundleEnvCellTopologyDiscoveryResult,
	StaticBundleLayerWorkerResult,
	StaticLandblockBundleLayerDiagnostics,
	StaticObjectBundleKind,
	StaticObjectBundleArtifact,
	VirtualTexturePageRef,
	VirtualTexturePageSampleClass,
	VirtualTexturePageUsageBucket,
} from "./static-bundle-layer";
import { formatStaticObjectBundleScopeKey } from "./static-bundle-layer";

describe("static bundle layer contract", () => {
	it("formats stable layer scope keys for landblock and env-cell layers", () => {
		expect(
			formatStaticObjectBundleScopeKey({
				kind: "landblock",
				landblockId: 0xda55ffff,
				bundleKind: "outdoor-buildings",
			}),
		).toBe("landblock:3663069183:outdoor-buildings");
		expect(
			formatStaticObjectBundleScopeKey({
				kind: "env-cell",
				landblockId: 0xda55ffff,
				envCellId: 0xda550155,
				bundleKind: "env-cell-static",
			}),
		).toBe("env-cell:3663069183:3663003989:env-cell-static");
	});

	it("represents compacted, direct, texture, and optional metadata outputs", () => {
		const usageBucket: VirtualTexturePageUsageBucket = "base-color";
		const sampleClass: VirtualTexturePageSampleClass = "rgba-color";
		const bundleKind: StaticObjectBundleKind = "outdoor-detail";
		const texturePageRef: VirtualTexturePageRef = {
			key: "texture:06000001",
			sourceAssetId: "prepared-texture/06000001?usage=raw",
			usageBucket,
			sampleClass,
			width: 1,
			height: 1,
			wrapS: "clamp",
			wrapT: "clamp",
			samplingDomain: "color",
			lookup: "color-filtered",
			bytes: new Uint8Array([255, 255, 255, 255]),
		};
		const materialRecord: StaticBundleMaterialRecord = {
			key: "material:08000001",
			familyKey: "rgba-texture-page",
			texturePageRefKeys: [texturePageRef.key],
			isTransparent: false,
		};
		const texturePage: StaticBundleTexturePage = {
			key: "page:base-color:0",
			scopeKey: "landblock:3663069183:outdoor-detail",
			pageKind: "single-entry",
			usageBucket,
			sampleClass,
			width: 1,
			height: 1,
			bytes: new Uint8Array([255, 255, 255, 255]),
			entries: [
				{
					virtualRefKey: texturePageRef.key,
					sourceAssetId: texturePageRef.sourceAssetId,
					rect: [0, 0, 1, 1],
				},
			],
		};
		const renderChunk: StaticBundleRenderChunk = {
			key: "chunk:da55ffff",
			landblockId: 0xda55ffff,
			bounds: null,
		};
		const compactedBatch: StaticBundleCompactedBatch = {
			key: "batch:0",
			renderChunkKey: renderChunk.key,
			familyKey: materialRecord.familyKey,
			materialRecordKey: materialRecord.key,
			objectKeys: ["object:0"],
			objectTriangleCounts: { "object:0": 0 },
			positions: new Float32Array(),
			normals: new Float32Array(),
			uvs: new Float32Array(),
			indices: new Uint16Array(),
		};
		const directEntry: StaticBundleDirectEntry = {
			key: "direct:0",
			renderChunkKey: renderChunk.key,
			materialRecordKey: materialRecord.key,
			objectKey: "object:0",
			positions: new Float32Array(),
			normals: new Float32Array(),
			uvs: new Float32Array(),
			indices: new Uint16Array(),
			bounds: null,
		};
		const partHint: StaticBundlePartHint = {
			renderKey: "part:0",
			partIndex: 0,
			gfxObjAssetId: "gfx-obj/01000001",
		};
		const objectRecord: StaticBundleObjectRecord = {
			objectKey: "object:0",
			visibilityKeys: ["outdoor-static:landblock:da55ffff:instance:0"],
			sourceAssetId: "gfx-obj/01000001",
			owningLandblockId: 0xda55ffff,
			owningEnvCellId: null,
			kind: "scenery",
			partHints: [partHint],
		};
		const spatialHint: StaticBundleSpatialHint = {
			key: "spatial:0",
			visibilityKeys: objectRecord.visibilityKeys,
			bounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 1, y: 1, z: 1 },
			},
		};
		const diagnostics: StaticLandblockBundleLayerDiagnostics = {
			sourceObjectCount: 1,
			compactedSurfaceCount: 1,
			directSurfaceCount: 1,
			skippedSurfaceCount: 0,
			missingAssetIds: [],
			skippedReasons: [],
		};
		const layer: StaticObjectBundleArtifact = {
			artifactKind: "static-object-bundle",
			key: "layer:detail",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
				bundleKind,
			},
			landblockId: 0xda55ffff,
			bundleKind,
			sourceRevision: "revision:0",
			rootAssetIds: ["landblock/da55ffff/outdoor"],
			preparedAssetIds: ["landblock/da55ffff/outdoor"],
			renderChunks: [renderChunk],
			compactedBatches: [compactedBatch],
			directEntries: [directEntry],
			materialRecords: [materialRecord],
			texturePageRefs: [texturePageRef],
			texturePages: [texturePage],
			objectRecords: [objectRecord],
			spatialHints: [spatialHint],
			diagnostics,
		};

		expect(layer.compactedBatches).toHaveLength(1);
		expect(layer.directEntries).toHaveLength(1);
		expect(layer.texturePageRefs[0]?.lookup).toBe("color-filtered");
		expect(layer.texturePages[0]?.entries[0]?.rect).toEqual([0, 0, 1, 1]);
	});

	it("represents worker build jobs, topology discovery, and worker results", () => {
		const buildJob: StaticBundleLayerWorkerJob = {
			type: "build-static-bundle-layer",
			jobId: "job:buildings",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
				bundleKind: "outdoor-buildings",
			},
			rootAssetIds: ["landblock/da55ffff/outdoor"],
			sourceRevision: "revision:roots",
			buildPolicyRevision: "build:v1",
			cpuTexturePagePolicyRevision: "texture-pages:v1",
		};
		const topologyJob: StaticBundleEnvCellTopologyDiscoveryJob = {
			type: "discover-static-env-cell-layer-scopes",
			jobId: "job:topology",
			landblockId: 0xda55ffff,
			sourceRevision: "revision:topology",
			buildPolicyRevision: "build:v1",
		};
		const topologyResult: StaticBundleEnvCellTopologyDiscoveryResult = {
			type: "static-env-cell-layer-scopes-discovered",
			jobId: topologyJob.jobId,
			landblockId: topologyJob.landblockId,
			sourceRevision: topologyJob.sourceRevision,
			discoveredScopes: [
				{
					scope: {
						kind: "env-cell",
						landblockId: 0xda55ffff,
						envCellId: 0xda550155,
						bundleKind: "env-cell-static",
					},
					rootAssetIds: ["env-cell/da550155", "landblock/da55ffff/topology"],
					topologyDependencyAssetIds: ["landblock/da55ffff/topology"],
				},
			],
			diagnostics: {
				envCellCount: 1,
				missingAssetIds: [],
			},
		};
		const workerResult: StaticBundleLayerWorkerResult = {
			type: "static-bundle-layer-built",
			jobId: buildJob.jobId,
			scope: buildJob.scope,
			sourceRevision: buildJob.sourceRevision,
			bundleLayer: {
				key: "layer:buildings",
				scope: buildJob.scope,
				landblockId: 0xda55ffff,
				bundleKind: "outdoor-buildings",
				sourceRevision: buildJob.sourceRevision,
				rootAssetIds: buildJob.rootAssetIds,
				preparedAssetIds: buildJob.rootAssetIds,
				renderChunks: [],
				compactedBatches: [],
				directEntries: [],
				materialRecords: [],
				texturePageRefs: [],
				texturePages: [],
				objectRecords: [],
				diagnostics: {
					sourceObjectCount: 0,
					compactedSurfaceCount: 0,
					directSurfaceCount: 0,
					skippedSurfaceCount: 0,
					missingAssetIds: [],
					skippedReasons: [],
				},
			},
		};

		expect(buildJob.rootAssetIds).toEqual(["landblock/da55ffff/outdoor"]);
		expect(topologyResult.discoveredScopes[0]?.scope.bundleKind).toBe(
			"env-cell-static",
		);
		expect(workerResult.bundleLayer.rootAssetIds).toEqual(
			buildJob.rootAssetIds,
		);
	});
});
