import { describe, expect, it } from "vitest";

import {
	type PreparedAssetPayload,
	type PreparedAssetRecord,
} from "../assets/types";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import { buildTerrainBlendPlanSet } from "./terrain-blend-plan";

describe("buildTerrainBlendPlanSet", () => {
	it("creates renderer-neutral terrain blend plans for base and overlay pcodes", () => {
		const assetReadModel = createAssetReadModel([
			createRecord("terrain-material/1", createTerrainMaterialPayload(true)),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
			createRecord(
				"render-surface/06000010",
				createRenderSurfacePayload(0x06000010),
			),
			createRecord(
				"surface-texture/05000011",
				createSurfaceTexturePayload(0x06000011),
			),
			createRecord(
				"render-surface/06000011",
				createRenderSurfacePayload(0x06000011),
			),
			createRecord(
				"surface-texture/05000012",
				createSurfaceTexturePayload(0x06000012),
			),
			createRecord(
				"render-surface/06000012",
				createRenderSurfacePayload(0x06000012, 0xf4),
			),
		]);

		const planSet = buildTerrainBlendPlanSet({
			assetReadModel,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 2])],
		});

		const plan = planSet?.plans[0];
		expect(plan?.base.textureAssetId).toBe("surface-texture/05000010");
		expect(plan?.base.wrap).toBe("repeat");
		expect(plan?.base.tiling).toBe(4);
		expect(planSet?.planByPcode.get(plan?.pcode ?? 0)).toBe(plan);
		expect(plan?.overlays).toHaveLength(1);
		expect(plan?.overlays[0]?.terrain.textureAssetId).toBe(
			"surface-texture/05000011",
		);
		expect(plan?.overlays[0]?.alpha.wrap).toBe("clamp");
		expect(plan?.overlays[0]?.alpha.role).toBe("mask");
		expect(plan?.overlays[0]?.rotation).toBe(0);
		expect(planSet?.diagnostics).toEqual([]);
	});

	it("uses the selected render surface fallback list for terrain textures", () => {
		const assetReadModel = createAssetReadModel([
			createRecord("terrain-material/1", createTerrainMaterialPayload(false)),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(null, [0x06000010, 0x06000011]),
			),
			createRecord(
				"render-surface/06000011",
				createRenderSurfacePayload(0x06000011),
			),
		]);

		const planSet = buildTerrainBlendPlanSet({
			assetReadModel,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 1])],
		});

		expect(planSet?.plans[0]?.base.renderSurface.renderSurfaceId).toBe(
			0x06000011,
		);
		expect(planSet?.diagnostics).toEqual([]);
	});

	it("resolves all-road pcodes to road terrain without overlay masks", () => {
		const assetReadModel = createAssetReadModel([
			createRecord(
				"terrain-material/1",
				createTerrainMaterialPayload(true, {
					includeRoadTerrain: true,
				}),
			),
			createRecord(
				"surface-texture/05000030",
				createSurfaceTexturePayload(0x06000030),
			),
			createRecord(
				"render-surface/06000030",
				createRenderSurfacePayload(0x06000030),
			),
		]);

		const planSet = buildTerrainBlendPlanSet({
			assetReadModel,
			regionNumber: 1,
			pcodes: [terrainPcode([1, 1, 1, 1], [1, 2, 1, 2])],
		});

		const plan = planSet?.plans[0];
		expect(plan?.allRoad).toBe(true);
		expect(plan?.base.textureAssetId).toBe("surface-texture/05000030");
		expect(plan?.overlays).toEqual([]);
		expect(plan?.roads).toEqual([]);
		expect(planSet?.diagnostics).toEqual([]);
	});

	it("reports missing selected terrain render surfaces", () => {
		const assetReadModel = createAssetReadModel([
			createRecord("terrain-material/1", createTerrainMaterialPayload(false)),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
		]);

		const planSet = buildTerrainBlendPlanSet({
			assetReadModel,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 1])],
		});

		expect(planSet).toBeNull();
	});
});

function createAssetReadModel(records: PreparedAssetRecord[]) {
	return createTestPreparedAssetResolver(records);
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

function createTerrainMaterialPayload(
	includeOverlay: boolean,
	options: {
		includeRoadTerrain?: boolean;
	} = {},
): PreparedAssetPayload {
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
			...(includeOverlay
				? [
						{
							terrainType: 2,
							textureAssetId: "surface-texture/05000011",
							textureDid: 0x05000011,
							tiling: 4,
							colorVariation: null,
						},
					]
				: []),
			...(options.includeRoadTerrain === true
				? [
						{
							terrainType: 3,
							textureAssetId: "surface-texture/05000030",
							textureDid: 0x05000030,
							tiling: 2,
							colorVariation: null,
						},
					]
				: []),
		],
		terrainAlphaMaps: includeOverlay
			? [
					{
						alphaIndex: 0,
						selector: 8,
						alphaTextureAssetId: "surface-texture/05000012",
						alphaTextureDid: 0x05000012,
					},
				]
			: [],
		roadAlphaMaps: [],
		pcodeEncoding: {
			terrainCodeBits: 5,
			roadCodeBits: 2,
			sizeBitMask: 1 << 28,
		},
		dependencies: {
			surfaceTextureAssetIds: includeOverlay
				? [
						"surface-texture/05000010",
						"surface-texture/05000011",
						"surface-texture/05000012",
					]
				: options.includeRoadTerrain === true
					? ["surface-texture/05000030"]
					: ["surface-texture/05000010"],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createSurfaceTexturePayload(
	selectedRenderSurfaceId: number | null,
	renderSurfaceIds: readonly number[] = selectedRenderSurfaceId === null
		? []
		: [selectedRenderSurfaceId],
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
		renderSurfaceIds: [...renderSurfaceIds],
		dependencies: {
			renderSurfaceAssetIds: renderSurfaceIds.map(
				(renderSurfaceId) =>
					`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			),
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	formatRaw = 0x14,
): PreparedAssetPayload {
	const sourceBytes =
		formatRaw === 0xf4
			? new Uint8Array([255])
			: new Uint8Array([255, 255, 255]);
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
		format: formatRaw === 0xf4 ? "CustomLandscapeAlpha" : "R8G8B8",
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
		},
	};
}

function terrainPcode(
	roadCodes: [number, number, number, number],
	terrainCodes: [number, number, number, number],
): number {
	return (
		(1 << 28) |
		(roadCodes[0] << 26) |
		(roadCodes[1] << 24) |
		(roadCodes[2] << 22) |
		(roadCodes[3] << 20) |
		(terrainCodes[0] << 15) |
		(terrainCodes[1] << 10) |
		(terrainCodes[2] << 5) |
		terrainCodes[3]
	);
}

function createProvenance(sourceAssetKind: string) {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
