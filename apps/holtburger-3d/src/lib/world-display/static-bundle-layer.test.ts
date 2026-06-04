import { describe, expect, it } from "vitest";

import type {
	StaticBundleCompactedBatch,
	StaticBundleDirectEntry,
	StaticBundleMaterialRecord,
	StaticBundleObjectRecord,
	StaticBundlePartHint,
	StaticBundleRenderChunk,
	StaticBundleSpatialHint,
	StaticLandblockBundleLayerDiagnostics,
	StaticLandblockBundleLayerKind,
	StaticLandblockRenderBundleLayer,
	VirtualTexturePageRef,
	VirtualTexturePageSampleClass,
	VirtualTexturePageUsageBucket,
} from "./static-bundle-layer";
import { formatStaticBundleLayerScopeKey } from "./static-bundle-layer";

describe("static bundle layer contract", () => {
	it("formats stable layer scope keys for landblock and env-cell layers", () => {
		expect(
			formatStaticBundleLayerScopeKey({
				kind: "landblock",
				landblockId: 0xda55ffff,
				layerKind: "outdoor-buildings",
			}),
		).toBe("landblock:3663069183:outdoor-buildings");
		expect(
			formatStaticBundleLayerScopeKey({
				kind: "env-cell",
				landblockId: 0xda55ffff,
				envCellId: 0xda550155,
				layerKind: "env-cell-static",
			}),
		).toBe("env-cell:3663069183:3663003989:env-cell-static");
	});

	it("represents compacted, direct, texture, and optional metadata outputs", () => {
		const usageBucket: VirtualTexturePageUsageBucket = "base-color";
		const sampleClass: VirtualTexturePageSampleClass = "rgba-color";
		const layerKind: StaticLandblockBundleLayerKind = "outdoor-detail";
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
		const layer: StaticLandblockRenderBundleLayer = {
			key: "layer:detail",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
				layerKind,
			},
			landblockId: 0xda55ffff,
			layerKind,
			sourceRevision: "revision:0",
			preparedAssetIds: ["landblock/da55ffff/outdoor"],
			renderChunks: [renderChunk],
			compactedBatches: [compactedBatch],
			directEntries: [directEntry],
			materialRecords: [materialRecord],
			texturePageRefs: [texturePageRef],
			objectRecords: [objectRecord],
			spatialHints: [spatialHint],
			diagnostics,
		};

		expect(layer.compactedBatches).toHaveLength(1);
		expect(layer.directEntries).toHaveLength(1);
		expect(layer.texturePageRefs[0]?.lookup).toBe("color-filtered");
	});
});
