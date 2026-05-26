import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetPayload,
	type PreparedAssetRecord,
	type PreparedTerrainQuad,
} from "../assets/types";
import { buildTerrainMaterialResourcePlan } from "./terrain-materials";

describe("buildTerrainMaterialResourcePlan", () => {
	it("reports a missing terrain material table without hiding referenced pcodes", () => {
		const plan = buildTerrainMaterialResourcePlan({
			assetState: createInitialAssetChannelState(),
			regionNumber: 1,
			quads: [
				createTerrainQuad({ pcode: 1234, cornerTerrainCodes: [1, 2, 3, 4] }),
			],
		});

		expect(plan.status).toBe("missing-table");
		expect(plan.terrainMaterialAssetId).toBe("terrain-material/1");
		expect(plan.uniquePcodeCount).toBe(1);
		expect(plan.referencedTerrainCodes).toEqual([1, 2, 3, 4]);
		expect(plan.diagnostics).toContain(
			"Missing terrain material table terrain-material/1.",
		);
	});

	it("summarizes ready terrain table and selected render-surface dependencies", () => {
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = indexByAssetId([
			createRecord("terrain-material/1", createTerrainMaterialPayload()),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
			createRecord(
				"render-surface/06000010",
				createRenderSurfacePayload(0x06000010, 0x14),
			),
		]);

		const plan = buildTerrainMaterialResourcePlan({
			assetState: state,
			regionNumber: 1,
			quads: [
				createTerrainQuad({ pcode: 55, cornerTerrainCodes: [1, 1, 1, 1] }),
			],
		});

		expect(plan.status).toBe("ready");
		expect(plan.terrainTypeCount).toBe(1);
		expect(plan.terrainAlphaMapCount).toBe(1);
		expect(plan.roadAlphaMapCount).toBe(1);
		expect(plan.missingSurfaceTextureAssetIds).toEqual([]);
		expect(plan.missingRenderSurfaceAssetIds).toEqual([]);
		expect(plan.unsupportedRenderSurfaceAssetIds).toEqual([]);
	});

	it("separates missing source textures from unsupported selected render surfaces", () => {
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = indexByAssetId([
			createRecord("terrain-material/1", createTerrainMaterialPayload()),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
			createRecord(
				"render-surface/06000010",
				createRenderSurfacePayload(0x06000010, 0xffff),
			),
		]);

		const plan = buildTerrainMaterialResourcePlan({
			assetState: state,
			regionNumber: 1,
			quads: [
				createTerrainQuad({ pcode: 55, cornerTerrainCodes: [1, 2, 1, 2] }),
			],
		});

		expect(plan.status).toBe("unsupported-render-surface");
		expect(plan.missingTerrainTypes).toEqual([2]);
		expect(plan.unsupportedRenderSurfaceAssetIds).toEqual([
			"render-surface/06000010",
		]);
	});

	it("does not include region-profile detail textures in base terrain readiness", () => {
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = indexByAssetId([
			createRecord("terrain-material/1", createTerrainMaterialPayload()),
			createRecord("region-render-profile/1", createRegionRenderProfilePayload()),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
			createRecord(
				"render-surface/06000010",
				createRenderSurfacePayload(0x06000010, 0x14),
			),
			createRecord(
				"surface-texture/05000020",
				createSurfaceTexturePayload(0x06000020),
			),
			createRecord(
				"render-surface/06000020",
				createRenderSurfacePayload(0x06000020, 0xffff),
			),
		]);

		const plan = buildTerrainMaterialResourcePlan({
			assetState: state,
			regionNumber: 1,
			quads: [
				createTerrainQuad({ pcode: 55, cornerTerrainCodes: [1, 1, 1, 1] }),
			],
		});

		expect(plan.status).toBe("ready");
		expect(plan.unsupportedRenderSurfaceAssetIds).toEqual([]);
	});
});

function indexByAssetId(
	records: readonly PreparedAssetRecord[],
): AssetChannelState["preparedByAssetId"] {
	return Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
}

function createRecord(
	assetId: string,
	payload: PreparedAssetPayload,
): PreparedAssetRecord {
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: { kind: payload.kind },
		},
		payload,
		preparedAt: "2026-05-26T00:00:00.000Z",
	};
}

function createTerrainMaterialPayload(): PreparedAssetPayload {
	return {
		kind: "terrain-material",
		sourceAssetKind: "terrain-material",
		residencyKind: "unknown",
		provenance: createProvenance("terrain-material"),
		regionNumber: 1,
		materialKind: "tex-merge-table",
		terrainTypes: [
			{
				terrainType: 1,
				textureAssetId: "surface-texture/05000010",
				textureDid: 0x05000010,
				tiling: 4,
				colorVariation: null,
			},
		],
		terrainAlphaMaps: [
			{
				alphaIndex: 1,
				alphaTextureAssetId: "surface-texture/05000010",
				alphaTextureDid: 0x05000010,
				selector: 1,
			},
		],
		roadAlphaMaps: [
			{
				roadIndex: 1,
				roadTextureAssetId: "surface-texture/05000010",
				roadTextureDid: 0x05000010,
				alphaTextureAssetId: "surface-texture/05000010",
				alphaTextureDid: 0x05000010,
				selector: 1,
			},
		],
		pcodeEncoding: {
			terrainCodeBits: 5,
			roadCodeBits: 2,
			sizeBitMask: 1 << 28,
		},
		dependencies: {
			surfaceTextureAssetIds: ["surface-texture/05000010"],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createRegionRenderProfilePayload(): PreparedAssetPayload {
	return {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionNumber: 1,
		detailRoles: {
			landscape: {
				role: "landscape",
				sourceTerrainDescIndex: 0,
				textureAssetId: "surface-texture/05000020",
				textureDid: 0x05000020,
				tiling: 8,
				fadeNear: 10,
				fadeFar: 50,
			},
			building: null,
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: ["surface-texture/05000020"],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createSurfaceTexturePayload(
	selectedRenderSurfaceId: number | null,
): PreparedAssetPayload {
	return {
		kind: "surface-texture",
		sourceAssetKind: "surface-texture",
		residencyKind: "unknown",
		provenance: createProvenance("surface-texture"),
		surfaceTextureId: 0x05000010,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId,
		renderSurfaceIds: selectedRenderSurfaceId === null ? [] : [selectedRenderSurfaceId],
		dependencies: {
			renderSurfaceAssetIds:
				selectedRenderSurfaceId === null
					? []
					: [
							`render-surface/${selectedRenderSurfaceId.toString(16).padStart(8, "0")}`,
						],
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	formatRaw: number,
): PreparedAssetPayload {
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance("render-surface"),
		renderSurfaceId,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw,
		format: `0x${formatRaw.toString(16)}`,
		sourceByteLength: 3,
		sourceBytes: new Uint8Array([0, 0, 0]),
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
		},
	};
}

function createTerrainQuad(options: {
	pcode: number;
	cornerTerrainCodes: [number, number, number, number];
}): PreparedTerrainQuad {
	return {
		terrainQuadId: "quad-0",
		row: 0,
		col: 0,
		quadIndex: 0,
		sourceTerrainIndices: [0, 1, 9, 10],
		vertexIndices: [0, 1, 9, 10],
		triangleIndices: [0, 1],
		diagonal: "southwest-northeast",
		cornerTerrainCodes: options.cornerTerrainCodes,
		pcode: options.pcode,
		averageHeight: 0,
		bounds: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: 1, y: 1, z: 1 },
		},
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
