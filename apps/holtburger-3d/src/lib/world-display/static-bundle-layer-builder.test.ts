import { describe, expect, it } from "vitest";

import type {
	PreparedAssetRecord,
	PreparedTexturePayload,
} from "../assets/types";
import { formatPreparedTextureAssetId } from "../assets/types";
import {
	formatLandblockOutdoorAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../landblocks";
import type { StaticBundleLayerWorkerJob } from "./static-bundle-layer";
import {
	buildStaticObjectBundleArtifact,
	collectWorkerPreparedDependencyIds,
} from "./static-bundle-layer-builder";

describe("static bundle layer builder", () => {
	it("builds compacted and direct layer outputs with layer-owned texture pages", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000001", "material/08000001", 1),
			createGfxObj("gfx-obj/01000002", "material/08000002", 1),
			createGfxObj("gfx-obj/01000003", "material/08000003", 2),
			createMaterial("material/08000001", "render-surface/06000001"),
			createMaterial("material/08000002", "render-surface/06000002", {
				surfaceType: 0x10,
			}),
			createMaterial("material/08000003", "render-surface/06000003"),
			createRenderSurface("render-surface/06000001"),
			createRenderSurface("render-surface/06000002"),
			createRenderSurface("render-surface/06000003"),
			createPreparedTexture(0x06000001, "raw", [255, 0, 0, 255]),
			createPreparedTexture(0x06000001, "detail", [255, 128, 0, 255]),
			createPreparedTexture(0x06000002, "raw", [0, 255, 0, 255], 8),
			createPreparedTexture(0x06000002, "detail", [0, 128, 255, 255], 8),
			createPreparedTexture(0x06000003, "raw", [64, 64, 255, 255]),
			createPreparedTexture(0x06000003, "detail", [64, 255, 255, 255]),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(layer.rootAssetIds).toEqual([
			formatLandblockOutdoorAssetId(landblockId),
		]);
		expect(
			layer.objectRecords.map((object) => object.visibilityKeys[0]),
		).toEqual([
			"outdoor-static:landblock:da55ffff:instance:compactable-0",
			"outdoor-static:landblock:da55ffff:instance:direct-0",
			"outdoor-static:landblock:da55ffff:instance:compactable-1",
		]);
		expect(layer.spatialHints).toEqual([
			{
				key: "outdoor-static:da55ffff:compactable-0",
				visibilityKeys: [
					"outdoor-static:landblock:da55ffff:instance:compactable-0",
				],
				bounds: {
					min: { x: 0, y: 0, z: 0 },
					max: { x: 1, y: 1, z: 1 },
				},
			},
			{
				key: "outdoor-static:da55ffff:compactable-1",
				visibilityKeys: [
					"outdoor-static:landblock:da55ffff:instance:compactable-1",
				],
				bounds: {
					min: { x: 2, y: 0, z: 0 },
					max: { x: 3, y: 1, z: 1 },
				},
			},
			{
				key: "outdoor-static:da55ffff:direct-0",
				visibilityKeys: [
					"outdoor-static:landblock:da55ffff:instance:direct-0",
				],
				bounds: {
					min: { x: 1, y: 0, z: 0 },
					max: { x: 2, y: 1, z: 1 },
				},
			},
		]);
		expect(layer.preparedAssetIds).toContain("material/08000001");
		expect(layer.preparedAssetIds).toContain("render-surface/06000001");
		expect(layer.preparedAssetIds).toContain(
			formatPreparedTextureAssetId({
				renderSurfaceId: 0x06000001,
				usage: "raw",
				outputFormat: "rgba8",
				mipPolicy: "none",
				colorSpace: "linear",
			}),
		);
		expect(layer.compactedBatches).toHaveLength(2);
		expect(layer.compactedBatches[0]?.positions).toBeInstanceOf(Float32Array);
		expect(
			layer.compactedBatches.map((batch) => batch.materialRecordKey),
		).toEqual([
			"material:material/08000001:variant:sampler=clamp",
			"material:material/08000003:variant:sampler=clamp",
		]);
		expect(layer.directEntries).toHaveLength(1);
		expect(layer.directEntries[0]?.positions).toBeInstanceOf(Float32Array);
		expect(layer.directEntries[0]?.positions.length).toBeGreaterThan(0);
		expect(
			Array.from(layer.directEntries[0]?.positions.slice(0, 3) ?? []),
		).toEqual([2, 1, 1]);
		expect(layer.directEntries[0]?.uvs.length).toBeGreaterThan(0);
		expect(layer.directEntries[0]?.indices.length).toBeGreaterThan(0);
		expect(
			layer.materialRecords.map((record) => [record.key, record.familyKey]),
		).toContainEqual([
			"material:material/08000002:variant:sampler=clamp",
			"static:transparent-blended:alpha=transparent-blend",
		]);
		expect(layer.texturePages.map((page) => page.pageKind).sort()).toEqual([
			"packed-atlas",
			"single-entry",
		]);
		expect(
			layer.texturePages.filter((page) => page.pageKind === "packed-atlas"),
		).toHaveLength(1);
		expect(
			layer.texturePages.filter((page) => page.pageKind === "single-entry"),
		).toHaveLength(1);
		expect(layer.diagnostics).toMatchObject({
			sourceObjectCount: 3,
			compactedSurfaceCount: 2,
			directSurfaceCount: 1,
			skippedSurfaceCount: 0,
		});
	});

	it("keeps sampler/filtering policy out of CPU texture page artifact keys", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000001", "material/08000001", 1),
			createGfxObj("gfx-obj/01000002", "material/08000002", 1),
			createGfxObj("gfx-obj/01000003", "material/08000003", 2),
			createMaterial("material/08000001", "render-surface/06000001"),
			createMaterial("material/08000002", "render-surface/06000002", {
				surfaceType: 0x10,
			}),
			createMaterial("material/08000003", "render-surface/06000003"),
			createRenderSurface("render-surface/06000001"),
			createRenderSurface("render-surface/06000002"),
			createRenderSurface("render-surface/06000003"),
			createPreparedTexture(0x06000001, "raw", [255, 0, 0, 255]),
			createPreparedTexture(0x06000001, "detail", [255, 128, 0, 255]),
			createPreparedTexture(0x06000002, "raw", [0, 255, 0, 255]),
			createPreparedTexture(0x06000002, "detail", [0, 128, 255, 255]),
			createPreparedTexture(0x06000003, "raw", [64, 64, 255, 255]),
			createPreparedTexture(0x06000003, "detail", [64, 255, 255, 255]),
		];

		const first = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy("texture-pages:v1"),
		});
		const second = buildStaticObjectBundleArtifact({
			job: {
				...job,
				cpuTexturePagePolicyRevision: "texture-pages:v1",
			},
			preparedAssets,
			policy: createPolicy("texture-pages:v1"),
		});

		expect(first.texturePages.map((page) => page.key)).toEqual(
			second.texturePages.map((page) => page.key),
		);
	});

	it("classifies direct alpha clipmaps as cutout static materials", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("clipmap-0", "gfx-obj/01000020"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000020", "material/08000020", 1),
			createMaterial("material/08000020", "render-surface/06000020", {
				surfaceType: 0x4,
			}),
			createRenderSurface("render-surface/06000020"),
			createPreparedTexture(0x06000020, "raw", [255, 255, 255, 128]),
			createPreparedTexture(0x06000020, "detail", [255, 255, 255, 255]),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(layer.materialRecords).toMatchObject([
			{
				key: "material:material/08000020:variant:sampler=clamp",
				familyKey: "static:textured-opaque:alpha=cutout",
				isTransparent: false,
			},
		]);
		expect(layer.compactedBatches[0]?.familyKey).toBe(
			"static:textured-opaque:alpha=cutout",
		);
		expect(layer.directEntries).toEqual([]);
	});

	it("splits gfx object geometry by surface slot material", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("multi-surface", "gfx-obj/01000010"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createMultiSurfaceGfxObj("gfx-obj/01000010", [
				"material/08000001",
				"material/08000002",
			]),
			createMaterial("material/08000001", "render-surface/06000001"),
			createMaterial("material/08000002", "render-surface/06000002"),
			createRenderSurface("render-surface/06000001"),
			createRenderSurface("render-surface/06000002"),
			createPreparedTexture(0x06000001, "raw", [255, 0, 0, 255]),
			createPreparedTexture(0x06000001, "detail", [255, 128, 0, 255]),
			createPreparedTexture(0x06000002, "raw", [0, 255, 0, 255]),
			createPreparedTexture(0x06000002, "detail", [0, 128, 255, 255]),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(
			layer.compactedBatches.map((batch) => [
				batch.materialRecordKey,
				batch.indices.length / 3,
			]),
		).toEqual([
			["material:material/08000001:variant:sampler=clamp", 1],
			["material:material/08000002:variant:sampler=repeat", 1],
		]);
		expect(layer.directEntries).toEqual([]);
		expect(layer.materialRecords.map((record) => record.key)).toEqual([
			"material:material/08000001:variant:sampler=clamp",
			"material:material/08000002:variant:sampler=repeat",
		]);
		expect(
			layer.texturePageRefs.map((ref) => [ref.key, ref.wrapS, ref.wrapT]),
		).toContainEqual([
			"texture:material:material/08000002:variant:sampler=repeat:prepared-texture/06000002?usage=raw&out=rgba8&mips=none&cs=linear",
			"repeat",
			"repeat",
		]);
	});

	it("bakes static instance placement and source scale into geometry positions", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("placed", "gfx-obj/01000001", {
					localPlacement: createPlacement({ x: 10, y: 20, z: 30 }),
					sourceScale: { x: 2, y: 3, z: 4 },
				}),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000001", "material/08000001", 1),
			createMaterial("material/08000001", "render-surface/06000001"),
			createRenderSurface("render-surface/06000001"),
			createPreparedTexture(0x06000001, "raw", [255, 0, 0, 255]),
			createPreparedTexture(0x06000001, "detail", [255, 128, 0, 255]),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(
			Array.from(layer.compactedBatches[0]?.positions.slice(0, 3) ?? []),
		).toEqual([12, 34, -17]);
	});

	it("builds indexed-paletted static material refs and compacted family records", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("indexed-0", "gfx-obj/01000011"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000011", "material/08000011", 1),
			createMaterial("material/08000011", "render-surface/06000011", {
				paletteId: 0x04000011,
			}),
			createIndexedRenderSurface("render-surface/06000011", 0x04000011),
			createPalette("palette/04000011"),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(
			layer.texturePageRefs.map((ref) => [
				ref.usageBucket,
				ref.sampleClass,
				ref.samplingDomain,
				ref.lookup,
			]),
		).toEqual([
			["palette-lookup", "palette-data", "data", "exact"],
			["indexed-texels", "indexed-data", "data", "exact"],
		]);
		expect(
			layer.texturePages.map((page) => [
				page.usageBucket,
				page.sampleClass,
				page.bytes.byteLength,
			]),
		).toEqual([
			["palette-lookup", "palette-data", 1024],
			["indexed-texels", "indexed-data", 4],
		]);
		expect(layer.materialRecords).toEqual([
			{
				key: "material:material/08000011:variant:sampler=clamp",
				familyKey: "static:indexed-paletted:alpha=opaque",
				color: [1, 1, 1, 1],
				texturePageRefKeys: [
					"texture:material:material/08000011:variant:sampler=clamp:palette/04000011:palette-lookup",
					"texture:material:material/08000011:variant:sampler=clamp:render-surface/06000011:indexed-texels",
				],
				isTransparent: false,
				indexedMaterial: {
					indexFormat: "p8",
					width: 2,
					height: 2,
					paletteColorCount: 256,
					wrapS: "clamp",
					wrapT: "clamp",
					clipThreshold: -1,
				},
			},
		]);
		expect(layer.compactedBatches).toHaveLength(1);
		expect(layer.compactedBatches[0]?.familyKey).toBe(
			"static:indexed-paletted:alpha=opaque",
		);
		expect(layer.directEntries).toEqual([]);
	});

	it("preserves indexed-paletted material family on direct cutout entries", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("indexed-cutout-0", "gfx-obj/01000021"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000021", "material/08000021", 1),
			createMaterial("material/08000021", "render-surface/06000021", {
				paletteId: 0x04000021,
				surfaceType: 0x4,
			}),
			createIndexedRenderSurface("render-surface/06000021", 0x04000021),
			createPalette("palette/04000021"),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(layer.materialRecords).toMatchObject([
			{
				key: "material:material/08000021:variant:sampler=clamp",
				familyKey: "static:indexed-paletted:alpha=cutout",
				isTransparent: false,
				indexedMaterial: {
					clipThreshold: 8,
				},
			},
		]);
		expect(layer.compactedBatches).toEqual([]);
		expect(layer.directEntries).toHaveLength(1);
	});

	it("preserves indexed-paletted detail refs without creating a separate material family", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("indexed-detail-0", "gfx-obj/01000012"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000012", "material/08000012", 1),
			createMaterial("material/08000012", "render-surface/06000012", {
				paletteId: 0x04000012,
				renderSurfaceAssetIds: [
					"render-surface/06000012",
					"render-surface/06000013",
				],
			}),
			createIndexedRenderSurface("render-surface/06000012", 0x04000012),
			createRenderSurface("render-surface/06000013"),
			createPalette("palette/04000012"),
			createPreparedTexture(0x06000013, "detail", [255, 128, 64, 255]),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(
			layer.texturePageRefs.map((ref) => [ref.usageBucket, ref.sampleClass]),
		).toEqual([
			["palette-lookup", "palette-data"],
			["indexed-texels", "indexed-data"],
		]);
		expect(layer.materialRecords[0]?.familyKey).toBe(
			"static:indexed-paletted:alpha=opaque",
		);
		expect(layer.compactedBatches).toHaveLength(1);
		expect(layer.directEntries).toEqual([]);
	});

	it("preserves 16-bit indexed texel format in static texture pages", () => {
		const landblockId = 0xda55ffff;
		const job = createBuildJob(landblockId);
		const preparedAssets = [
			createOutdoorLandblock(landblockId, [
				createOutdoorMember("indexed-16", "gfx-obj/01000013"),
			]),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
			createGfxObj("gfx-obj/01000013", "material/08000013", 1),
			createMaterial("material/08000013", "render-surface/06000014", {
				paletteId: 0x04000013,
			}),
			createIndexedRenderSurface("render-surface/06000014", 0x04000013, {
				format: "index16",
			}),
			createPalette("palette/04000013", 258),
		];

		const layer = buildStaticObjectBundleArtifact({
			job,
			preparedAssets,
			policy: createPolicy(),
		});

		expect(
			layer.texturePageRefs.find((ref) => ref.usageBucket === "indexed-texels"),
		).toMatchObject({
			sampleClass: "indexed-data",
			indexedFormat: "index16",
			width: 2,
			height: 2,
		});
		expect(
			layer.texturePages.find((page) => page.usageBucket === "indexed-texels"),
		).toMatchObject({
			sampleClass: "indexed-data",
			indexedFormat: "index16",
			width: 2,
			height: 2,
			bytes: new Uint8Array([0, 0, 1, 0, 0, 1, 1, 1]),
		});
	});

	it("fails hard when the worker-local closure is internally inconsistent", () => {
		const landblockId = 0xda55ffff;
		const preparedAssets = [
			createOutdoorLandblock(landblockId),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
		];

		expect(() =>
			buildStaticObjectBundleArtifact({
				job: createBuildJob(landblockId),
				preparedAssets,
				policy: createPolicy(),
			}),
		).toThrow(/missing required asset gfx-obj\/01000001/);
	});

	it("collects setup appearance companion dependencies for worker closures", () => {
		const setup = createSetupModel("setup-model/02000001", "gfx-obj/01000001");
		const preparedByAssetId = new Map(
			[
				setup,
				createSetupAppearance("setup-appearance/02000001", "gfx-obj/01000001"),
				createGfxObj("gfx-obj/01000001", "material/08000001", 1),
				createMaterial("material/08000001", "render-surface/06000001"),
				createRenderSurface("render-surface/06000001"),
				createPreparedTexture(0x06000001, "raw", [255, 0, 0, 255]),
				createPreparedTexture(0x06000001, "detail", [255, 128, 0, 255]),
			].map((asset) => [asset.request.assetId, asset] as const),
		);

		expect(
			collectWorkerPreparedDependencyIds(
				["setup-model/02000001"],
				preparedByAssetId,
			),
		).toContain("setup-appearance/02000001");
	});
});

function createBuildJob(landblockId: number): StaticBundleLayerWorkerJob {
	return {
		type: "build-static-bundle-layer",
		jobId: "job:outdoor-detail",
		scope: {
			kind: "landblock",
			landblockId,
			bundleKind: "outdoor-detail",
		},
		rootAssetIds: [formatLandblockOutdoorAssetId(landblockId)],
		sourceRevision: "revision:roots",
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision: "texture-pages:v1",
	};
}

function createPolicy(cpuTexturePagePolicyRevision = "texture-pages:v1") {
	return {
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision,
		atlasLayout: {
			maxTextureSize: 4,
			maxTextureCount: 2,
			gutterPixels: 0,
		},
	};
}

function createRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `fixture:${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `fixture:${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-06-04T00:00:00.000Z",
	};
}

function createOutdoorLandblock(
	landblockId: number,
	statics = [
		createOutdoorMember("compactable-0", "gfx-obj/01000001"),
		createOutdoorMember("direct-0", "gfx-obj/01000002"),
		createOutdoorMember("compactable-1", "gfx-obj/01000003"),
	],
): PreparedAssetRecord {
	return createRecord(formatLandblockOutdoorAssetId(landblockId), {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("landblock-outdoor"),
		landblockId,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
			gridSize: 0,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics,
		outdoorBvh: null,
		dependencies: {
			renderableSourceAssetIds: [
				"gfx-obj/01000001",
				"gfx-obj/01000002",
				"gfx-obj/01000003",
			],
			materialAssetIds: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	});
}

function createOutdoorMember(
	instanceId: string,
	sourceAssetId: string,
	options: {
		localPlacement?: ReturnType<typeof createPlacement>;
		sourceScale?: { x: number; y: number; z: number };
	} = {},
) {
	const x = instanceId === "compactable-0" ? 0 : instanceId === "direct-0" ? 1 : 2;
	return {
		kind: "explicit-object" as const,
		instanceId,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: options.localPlacement ?? createPlacement({ x, y: 0, z: 0 }),
		sourceScale: options.sourceScale ?? { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: {
			min: { x, y: 0, z: 0 },
			max: { x: x + 1, y: 1, z: 1 },
		},
		building: null,
		generated: null,
	};
}

function createGfxObj(
	assetId: string,
	materialAssetId: string,
	triangleCount: number,
): PreparedAssetRecord {
	const surfaceId = Number.parseInt(
		materialAssetId.slice("material/".length),
		16,
	);
	return createRecord(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		surfaceIds: [surfaceId],
		vertexArray: { vertexType: 0, vertexCount: 0, vertices: [] },
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: { materialAssetIds: [materialAssetId] },
		physicsWitness: {
			polygonCount: triangleCount,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: createRenderGeometry(triangleCount),
		sortCenter: null,
		didDegrade: null,
	});
}

function createMultiSurfaceGfxObj(
	assetId: string,
	materialAssetIds: readonly string[],
): PreparedAssetRecord {
	const surfaceIds = materialAssetIds.map((materialAssetId) =>
		Number.parseInt(materialAssetId.slice("material/".length), 16),
	);
	return createRecord(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		surfaceIds,
		vertexArray: { vertexType: 0, vertexCount: 0, vertices: [] },
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: { materialAssetIds: [...materialAssetIds] },
		physicsWitness: {
			polygonCount: materialAssetIds.length,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: createMultiSurfaceRenderGeometry(materialAssetIds.length),
		sortCenter: null,
		didDegrade: null,
	});
}

function createMaterial(
	assetId: string,
	renderSurfaceAssetId: string,
	options: {
		surfaceType?: number;
		translucency?: number;
		paletteId?: number;
		renderSurfaceAssetIds?: readonly string[];
	} = {},
): PreparedAssetRecord {
	const renderSurfaceId = Number.parseInt(
		renderSurfaceAssetId.slice("render-surface/".length),
		16,
	);
	return createRecord(assetId, {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance("material-recipe"),
		surfaceId: 1,
		surfaceType: options.surfaceType ?? 0,
		source: {
			kind: "texture",
			surfaceTextureId: renderSurfaceId,
			selectedRenderSurfaceId: renderSurfaceId,
			paletteId: options.paletteId ?? null,
			renderSurfaceDefaultPaletteIds: options.paletteId
				? [options.paletteId]
				: [],
		},
		translucency: options.translucency ?? 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				...(options.renderSurfaceAssetIds ?? [renderSurfaceAssetId]),
			],
			paletteAssetIds: options.paletteId
				? [`palette/${options.paletteId.toString(16).padStart(8, "0")}`]
				: [],
		},
	});
}

function createRenderSurface(assetId: string): PreparedAssetRecord {
	return createRecord(assetId, {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: Number.parseInt(
			assetId.slice("render-surface/".length),
			16,
		),
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: 0x15,
		format: "rgba8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 255, 255, 255]),
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	});
}

function createIndexedRenderSurface(
	assetId: string,
	defaultPaletteId: number,
	options: { format?: "p8" | "index16" } = {},
): PreparedAssetRecord {
	const format = options.format ?? "p8";
	const sourceBytes =
		format === "index16"
			? new Uint8Array([0, 0, 1, 0, 0, 1, 1, 1])
			: new Uint8Array([0, 1, 2, 3]);
	return createRecord(assetId, {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: Number.parseInt(
			assetId.slice("render-surface/".length),
			16,
		),
		unknown: 0,
		width: 2,
		height: 2,
		formatRaw: format === "index16" ? 0x65 : 0x29,
		format,
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId,
		dependencies: {
			paletteAssetIds: [
				`palette/${defaultPaletteId.toString(16).padStart(8, "0")}`,
			],
		},
	});
}

function createPalette(assetId: string, colorCount = 256): PreparedAssetRecord {
	return createRecord(assetId, {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: createProvenance("palette"),
		paletteId: Number.parseInt(assetId.slice("palette/".length), 16),
		colorCount,
		colorsArgb: new Uint32Array(
			Array.from(
				{ length: colorCount },
				(_, index) => 0xff000000 | (index << 16) | (index << 8) | index,
			),
		),
	});
}

function createPreparedTexture(
	renderSurfaceId: number,
	usage: PreparedTexturePayload["usage"],
	bytes: readonly number[],
	size = 1,
): PreparedAssetRecord {
	const assetId = formatPreparedTextureAssetId({
		renderSurfaceId,
		usage,
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
	});
	return createRecord(assetId, {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: createProvenance("prepared-texture"),
		renderSurfaceId,
		usage,
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: 0,
		sourceFormat: "rgba8",
		sourceWidth: size,
		sourceHeight: size,
		sourceByteLength: size * size * 4,
		sourceHash: assetId,
		levels: [
			{
				level: 0,
				width: size,
				height: size,
				formatRaw: 0,
				format: "rgba8",
				byteLength: size * size * 4,
				bytes: repeatRgba(bytes, size * size),
			},
		],
		dependencies: { renderSurfaceAssetIds: [] },
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: size * size * 4,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	});
}

function createSetupModel(
	assetId: string,
	gfxObjAssetId: string,
): PreparedAssetRecord {
	return createRecord(assetId, {
		kind: "setup-model",
		sourceAssetKind: "setup-model",
		residencyKind: "unknown",
		provenance: createProvenance("setup-model"),
		setupModelId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		parts: [
			{
				partIndex: 0,
				gfxObjId: 0x01000001,
				gfxObjAssetId,
				parentIndex: null,
				scale: null,
			},
		],
		holdingLocations: [],
		connectionPoints: [],
		placementSets: [],
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
		height: null,
		radius: null,
		stepUp: null,
		stepDown: null,
		sortingSphere: null,
		selectionSphere: null,
		lights: [],
		defaultAnimation: null,
		defaultScript: null,
		defaultMotionTable: null,
		defaultSoundTable: null,
		defaultScriptTable: null,
		dependencies: { gfxObjAssetIds: [gfxObjAssetId] },
	});
}

function createSetupAppearance(
	assetId: string,
	gfxObjAssetId: string,
): PreparedAssetRecord {
	return createRecord(assetId, {
		kind: "setup-appearance",
		sourceAssetKind: "setup-appearance",
		residencyKind: "unknown",
		provenance: createProvenance("setup-appearance"),
		setupModelId: Number.parseInt(assetId.slice(-8), 16),
		appearanceKey: assetId,
		parts: [
			{
				partIndex: 0,
				gfxObjId: 0x01000001,
				gfxObjAssetId,
				materialSlots: [
					{
						slotIndex: 0,
						surfaceId: 0x08000001,
						materialAssetId: "material/08000001",
					},
				],
			},
		],
		textureChanges: [],
		animPartChanges: [],
		paletteId: null,
		subPalettes: [],
		dependencies: {
			materialAssetIds: ["material/08000001"],
			paletteAssetIds: [],
		},
	});
}

function createRegionRenderProfile(regionNumber: number): PreparedAssetRecord {
	return createRecord(formatRegionRenderProfileAssetId(regionNumber), {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionNumber,
		detailRoles: {
			landscape: null,
			building: null,
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	});
}

function createTerrainMaterial(regionNumber: number): PreparedAssetRecord {
	return createRecord(formatTerrainMaterialAssetId(regionNumber), {
		kind: "terrain-material",
		sourceAssetKind: "terrain-material",
		residencyKind: "unknown",
		provenance: createProvenance("terrain-material"),
		regionNumber,
		materialKind: "tex-merge-table",
		terrainTypes: [],
		terrainAlphaMaps: [],
		roadAlphaMaps: [],
		pcodeEncoding: { terrainCodeBits: 5, roadCodeBits: 2, sizeBitMask: 0 },
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	});
}

function createRenderGeometry(triangleCount: number) {
	return {
		sourceId: 0,
		vertexCount: triangleCount * 3,
		triangleCount,
		positions: new Float32Array(triangleCount * 9).fill(1),
		normals: new Float32Array(triangleCount * 9).fill(0),
		uvs: new Float32Array(triangleCount * 6).fill(0.5),
		triangles: Array.from({ length: triangleCount }, (_, index) => ({
			polygonId: index,
			surfaceId: 0,
			materialVariantSignature: "sampler=clamp",
			firstVertex: index * 3,
		})),
		surfaceIds: [0],
		bounds: null,
	};
}

function createMultiSurfaceRenderGeometry(surfaceCount: number) {
	return {
		sourceId: 0,
		vertexCount: surfaceCount * 3,
		triangleCount: surfaceCount,
		positions: new Float32Array(surfaceCount * 9).fill(1),
		normals: new Float32Array(surfaceCount * 9).fill(0),
		uvs: new Float32Array(surfaceCount * 6).fill(0.5),
		triangles: Array.from({ length: surfaceCount }, (_, index) => ({
			polygonId: index,
			surfaceId: index,
			materialVariantSignature:
				index === 0 ? "sampler=clamp" : "sampler=repeat",
			firstVertex: index * 3,
		})),
		surfaceIds: Array.from({ length: surfaceCount }, (_, index) => index),
		bounds: null,
	};
}

function repeatRgba(bytes: readonly number[], pixelCount: number): Uint8Array {
	const result = new Uint8Array(pixelCount * 4);
	for (let index = 0; index < pixelCount; index += 1) {
		result.set(bytes, index * 4);
	}
	return result;
}

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
