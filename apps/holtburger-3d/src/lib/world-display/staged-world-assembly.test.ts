import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedMaterialRecipePayload,
	type PreparedPolygonSetRenderGeometry,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE } from "../assets/material-variants";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	buildStagedStructuredInteriorDrawUnitAssemblies,
	buildStagedStaticDrawUnitAssemblies,
	describeStagedWorldAssemblyGraphRecordSignature,
} from "./staged-world-assembly";
import type { RenderChunkTransform } from "./render-anchor";
import type { StaticRenderablePart } from "./static-renderables";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";

const PIXEL_FORMAT_DXT1 = 0x3154_5844;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const SURFACE_TYPE_DIFFUSE = 0x20;

describe("staged world assembly", () => {
	it("splits static draw units by material slot and keeps chunk-local geometry", () => {
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createTwoSlotGfxGeometry(), [
				createMaterialRecipeRecord({
					surfaceId: 0x08000001,
					renderSurfaceId: 0x06000001,
				}),
				createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
				createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
				createMaterialRecipeRecord({
					surfaceId: 0x08000002,
					renderSurfaceId: 0x06000002,
				}),
				createRenderSurfaceRecord({ renderSurfaceId: 0x06000002 }),
				createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000002 }),
			]),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [
					createStaticPart({
						materialSlots: [
							createMaterialSlot(0, 0x08000001),
							createMaterialSlot(1, 0x08000002),
						],
					}),
				],
			},
		});

		expect(drawUnits).toHaveLength(2);
		expect(drawUnits.map((unit) => unit.geometry.triangleCount)).toEqual([1, 1]);
		expect(drawUnits.map((unit) => unit.modelMatrix[12])).toEqual([10, 10]);
		expect(drawUnits.map((unit) => unit.geometry.uvs.length)).toEqual([6, 6]);
		expect(drawUnits.map((unit) => unit.preparedAssetIds[0])).toEqual([
			"gfx-obj/01000001",
			"gfx-obj/01000001",
		]);
		expect(drawUnits.map((unit) => unit.material.kind)).toEqual([
			"direct-texture",
			"direct-texture",
		]);
		expect(
			drawUnits.map((unit) =>
				unit.material.kind === "direct-texture" ? unit.material.textureKey : null,
			),
		).toEqual([
			"texture/06000001/827611204/8/8/none/clamp/clamp/linear/linear/linear",
			"texture/06000002/827611204/8/8/none/clamp/clamp/linear/linear/linear",
		]);
	});

	it("preserves static sampler variants from material-slot geometry", () => {
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createRepeatSlotGfxGeometry(), [
				createMaterialRecipeRecord({
					surfaceId: 0x08000001,
					renderSurfaceId: 0x06000001,
				}),
				createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
				createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
			]),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [
					createStaticPart({
						materialSlots: [createMaterialSlot(0, 0x08000001)],
					}),
				],
			},
		});

		expect(drawUnits).toHaveLength(1);
		expect(drawUnits[0]?.id).toContain("variant-sampler=repeat");
		expect(drawUnits[0]?.material.kind).toBe("direct-texture");
		expect(
			drawUnits[0]?.material.kind === "direct-texture"
				? drawUnits[0].material.textureKey
				: null,
		).toBe(
			"texture/06000001/827611204/8/8/none/repeat/repeat/linear/linear/linear",
		);
	});

	it("maps structured-interior geometry surfaces through env-cell material slots", () => {
		const drawUnits = buildStagedStructuredInteriorDrawUnitAssemblies({
			assetState: createAssetState(createStaticGfxGeometry(), [
				createMaterialRecipeRecord({
					surfaceId: 0x08000001,
					renderSurfaceId: 0x06000001,
				}),
				createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
				createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
			]),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			structuredInteriorScene: createStructuredInteriorScene(),
		});

		expect(drawUnits).toHaveLength(1);
		expect(drawUnits[0]?.id).toContain("slot=0|surface=134217729");
		expect(drawUnits[0]?.material.kind).toBe("direct-texture");
		expect(
			drawUnits[0]?.material.kind === "direct-texture"
				? drawUnits[0].material.textureKey
				: null,
		).toBe(
			"texture/06000001/827611204/8/8/none/repeat/repeat/linear/linear/linear",
		);
	});

	it("normalizes duplicate static BVH keys during draw-unit assembly", () => {
		const part = createStaticPart();
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createStaticGfxGeometry()),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [part, { ...part, gfxObjAssetId: "gfx-obj/01000002" }],
			},
		});

		for (const drawUnit of drawUnits) {
			expect(drawUnit.bvhBinding.itemKeys).toEqual([
				...new Set(drawUnit.bvhBinding.itemKeys),
			]);
		}
	});

	it("does not suppress indoor static parts for resident outdoor bundles in the same landblock", () => {
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createStaticGfxGeometry()),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [
					createStaticPart({ instanceId: "outdoor-a" }),
					createStaticPart({
						instanceId: "indoor-a",
						owningEnvCellId: 0x12340100,
						renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
						kind: "indoor-static",
					}),
				],
			},
			excludedRenderScope: {
				outdoorLandblockIds: new Set([0x12340000]),
				envCellIds: new Set(),
			},
		});

		expect(drawUnits).toHaveLength(1);
		expect(drawUnits[0]?.staticObjectKeys[0]).toContain("indoor-a");
		expect(drawUnits[0]?.staticObjectKeys[0]).toContain("305398016");
	});

	it("suppresses indoor static parts only for resident env-cell bundle scopes", () => {
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createStaticGfxGeometry()),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [
					createStaticPart({
						instanceId: "indoor-a",
						owningEnvCellId: 0x12340100,
						renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
						kind: "indoor-static",
					}),
					createStaticPart({
						instanceId: "indoor-b",
						owningEnvCellId: 0x12340200,
						renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
						kind: "indoor-static",
					}),
				],
			},
			excludedRenderScope: {
				outdoorLandblockIds: new Set(),
				envCellIds: new Set([0x12340100]),
			},
		});

		expect(drawUnits).toHaveLength(1);
		expect(drawUnits[0]?.staticObjectKeys[0]).toContain("indoor-b");
		expect(drawUnits[0]?.staticObjectKeys[0]).toContain("305398272");
	});

	it("creates stable graph signatures from sorted prepared dependencies", () => {
		const signature = describeStagedWorldAssemblyGraphRecordSignature({
			drawUnitId: "static-staged/test",
			label: "test",
			material: {
				kind: "flat",
				key: "flat/test",
				color: new Float32Array([1, 1, 1, 1]),
				behavior: null,
				fallbackReason: null,
				preparedAssetIds: [],
			},
			preparedAssetIds: ["z", "a", "z"],
		});

		expect(signature).toBe("test|flat|flat/test|none|a|z");
	});
});

function createAssetState(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	records: PreparedAssetRecord[] = [],
): AssetChannelState {
	const state = createInitialAssetChannelState();
	for (const assetId of ["gfx-obj/01000001", "gfx-obj/01000002"]) {
		state.preparedByAssetId[assetId] = {
			payload: {
				kind: "gfx-obj",
				renderGeometry,
			},
		} as AssetChannelState["preparedAsset"];
	}
	for (const record of records) {
		state.preparedByAssetId[record.request.assetId] = record;
	}
	return state;
}

function createStaticGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
		surfaceIds: [],
		bounds: null,
	};
}

function createTwoSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 6,
		triangleCount: 2,
		positions: new Float32Array([
			0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
		]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 2, 1, 1, 2]),
		triangles: [
			{ polygonId: 0, surfaceId: 0, firstVertex: 0 },
			{ polygonId: 1, surfaceId: 1, firstVertex: 3 },
		],
		surfaceIds: [0, 1],
		bounds: null,
	};
}

function createRepeatSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		...createStaticGfxGeometry(),
		uvs: new Float32Array([0, 0, 4, 0, 0, 4]),
		triangles: [
			{
				polygonId: 0,
				surfaceId: 0,
				firstVertex: 0,
				materialVariantSignature:
					LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE,
			},
		],
		surfaceIds: [0],
	};
}

function createStructuredInteriorScene(): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: [0x12340100],
		cells: [createStructuredInteriorCell()],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "test structured interior",
		cacheText: "test structured interior cache",
	};
}

function createStructuredInteriorCell(): StructuredInteriorCell {
	return {
		renderKey: "interior/env-cell/12340100",
		envCellId: 0x12340100,
		regionNumber: 1,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		environmentId: 0x0d000001,
		cellStructureId: 0x0d000001,
		isFocus: false,
		chunkLocalPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
		surfaceIds: [0x08000001],
		portalCount: 0,
		portals: [],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: null,
		cellBsp: null,
		renderGeometry: createRepeatSlotGfxGeometry(),
		debugColorKey: "interior-test",
		detailSignature: "detail:none",
	};
}

function createStaticPart({
	instanceId = "instance-a",
	owningEnvCellId = null,
	renderDomain = WORLD_RENDER_DOMAIN.exteriorStatic,
	kind = "scenery",
	materialSlots = [],
}: {
	instanceId?: string;
	owningEnvCellId?: StaticRenderablePart["owningEnvCellId"];
	renderDomain?: StaticRenderablePart["renderDomain"];
	kind?: StaticRenderablePart["kind"];
	materialSlots?: StaticRenderablePart["materialSlots"];
} = {}): StaticRenderablePart {
	return {
		renderKey: "static/group",
		renderDomain,
		instanceId,
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: 0x12340000,
		regionNumber: 1,
		owningEnvCellId,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		kind,
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots,
		materialSignature: "base",
		parentPlacements: [],
		chunkLocalInstancePlacement: createPlacement({ x: 1, y: 2, z: 3 }),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "instance-a",
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind: "scenery",
		detailSignature: "detail:none",
	};
}

function createMaterialSlot(
	slotIndex: number,
	surfaceId: number,
): StaticRenderablePart["materialSlots"][number] {
	return {
		slotIndex,
		surfaceId,
		materialAssetId: `material/${surfaceId.toString(16).padStart(8, "0")}`,
		materialVariantSignature: null,
	};
}

function createMaterialRecipeRecord(options: {
	surfaceId: number;
	renderSurfaceId: number;
}): PreparedAssetRecord {
	const assetId = `material/${options.surfaceId.toString(16).padStart(8, "0")}`;
	return createRecord(assetId, {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance(),
		surfaceId: options.surfaceId,
		surfaceType: SURFACE_TYPE_DIFFUSE,
		source: {
			kind: "texture",
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: options.renderSurfaceId,
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
			paletteAssetIds: [],
		},
	} satisfies PreparedMaterialRecipePayload);
}

function createRenderSurfaceRecord(options: {
	renderSurfaceId: number;
}): PreparedAssetRecord {
	const assetId = `render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`;
	return createRecord(assetId, {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance(),
		renderSurfaceId: options.renderSurfaceId,
		unknown: 0,
		width: 8,
		height: 8,
		formatRaw: PIXEL_FORMAT_DXT1,
		format: "DXT1",
		sourceByteLength: 32,
		sourceBytes: new Uint8Array(32),
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	} satisfies PreparedRenderSurfacePayload);
}

function createAtlasPreparedTextureRecord(options: {
	renderSurfaceId: number;
}): PreparedAssetRecord {
	const assetId = formatAtlasReadyPreparedTextureAssetId({
		renderSurfaceId: options.renderSurfaceId,
		usage: "raw",
	});
	return createRecord(assetId, {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: createProvenance(),
		renderSurfaceId: options.renderSurfaceId,
		usage: "raw",
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: PIXEL_FORMAT_DXT1,
		sourceFormat: "DXT1",
		sourceWidth: 8,
		sourceHeight: 8,
		sourceByteLength: 32,
		sourceHash: `hash-${options.renderSurfaceId}`,
		levels: [
			{
				level: 0,
				width: 8,
				height: 8,
				formatRaw: PIXEL_FORMAT_A8R8G8B8,
				format: "A8R8G8B8",
				byteLength: 256,
				bytes: new Uint8Array(256),
			},
		],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: 256,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	} satisfies PreparedTexturePayload);
}

function createRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: { assetId },
		response: { assetId, status: "ready", payload },
		payload,
		preparedAt: "test",
	} as PreparedAssetRecord;
}

function createProvenance() {
	return {
		source: "cache",
		sourceAssetKind: null,
		errorCode: null,
		detail: null,
	} as const;
}

function createPlacement(origin: RenderChunkTransform["offset"]) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
