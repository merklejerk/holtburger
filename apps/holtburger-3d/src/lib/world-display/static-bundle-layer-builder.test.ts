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
	buildStaticLandblockRenderBundleLayer,
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

		const layer = buildStaticLandblockRenderBundleLayer({
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
		).toEqual(["material:material/08000001", "material:material/08000003"]);
		expect(layer.directEntries).toHaveLength(1);
		expect(
			layer.materialRecords.map((record) => [record.key, record.familyKey]),
		).toContainEqual([
			"material:material/08000002",
			"static:direct:alpha=transparent-blend",
		]);
		expect(layer.texturePages.map((page) => page.pageKind).sort()).toEqual([
			"packed-atlas",
			"packed-atlas",
			"single-entry",
			"single-entry",
		]);
		expect(
			layer.texturePages.filter((page) => page.pageKind === "packed-atlas"),
		).toHaveLength(2);
		expect(
			layer.texturePages.filter((page) => page.pageKind === "single-entry"),
		).toHaveLength(2);
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

		const first = buildStaticLandblockRenderBundleLayer({
			job,
			preparedAssets,
			policy: createPolicy("texture-pages:v1"),
		});
		const second = buildStaticLandblockRenderBundleLayer({
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

	it("fails hard when the worker-local closure is internally inconsistent", () => {
		const landblockId = 0xda55ffff;
		const preparedAssets = [
			createOutdoorLandblock(landblockId),
			createRegionRenderProfile(1),
			createTerrainMaterial(1),
		];

		expect(() =>
			buildStaticLandblockRenderBundleLayer({
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
			layerKind: "outdoor-detail",
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

function createOutdoorLandblock(landblockId: number): PreparedAssetRecord {
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
		statics: [
			createOutdoorMember("compactable-0", "gfx-obj/01000001"),
			createOutdoorMember("direct-0", "gfx-obj/01000002"),
			createOutdoorMember("compactable-1", "gfx-obj/01000003"),
		],
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

function createOutdoorMember(instanceId: string, sourceAssetId: string) {
	return {
		kind: "explicit-object" as const,
		instanceId,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: identityPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
		building: null,
		generated: null,
	};
}

function createGfxObj(
	assetId: string,
	materialAssetId: string,
	triangleCount: number,
): PreparedAssetRecord {
	return createRecord(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		surfaceIds: [1],
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

function createMaterial(
	assetId: string,
	renderSurfaceAssetId: string,
	options: { surfaceType?: number; translucency?: number } = {},
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
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: options.translucency ?? 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [renderSurfaceAssetId],
			paletteAssetIds: [],
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
					{ slotIndex: 0, surfaceId: 1, materialAssetId: "material/08000001" },
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
			surfaceId: 1,
			materialVariantSignature: "sampler=clamp",
			firstVertex: index * 3,
		})),
		surfaceIds: [1],
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

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
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
