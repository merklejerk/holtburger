import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetPayload,
	type PreparedAssetRecord,
} from "../assets/types";
import { buildTerrainBlendPlanSet } from "./terrain-blend-plan";

describe("buildTerrainBlendPlanSet", () => {
	it("creates renderer-neutral terrain blend plans for base and overlay pcodes", () => {
		const state = createAssetState([
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
			assetState: state,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 2])],
		});

		const plan = planSet?.plans[0];
		expect(plan?.base.textureAssetId).toBe("surface-texture/05000010");
		expect(plan?.base.wrap).toBe("repeat");
		expect(plan?.base.tiling).toBe(4);
		expect(plan?.overlays).toHaveLength(1);
		expect(plan?.overlays[0]?.terrain.textureAssetId).toBe(
			"surface-texture/05000011",
		);
		expect(plan?.overlays[0]?.alpha.wrap).toBe("clamp");
		expect(plan?.overlays[0]?.alpha.role).toBe("mask");
		expect(planSet?.diagnostics).toEqual([]);
	});

	it("reports missing selected terrain render surfaces", () => {
		const state = createAssetState([
			createRecord("terrain-material/1", createTerrainMaterialPayload(false)),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
		]);

		const planSet = buildTerrainBlendPlanSet({
			assetState: state,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 1])],
		});

		expect(planSet).toBeNull();
	});
});

function createAssetState(records: PreparedAssetRecord[]): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
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
				: ["surface-texture/05000010"],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createSurfaceTexturePayload(
	selectedRenderSurfaceId: number,
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
		renderSurfaceIds: [selectedRenderSurfaceId],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${selectedRenderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	formatRaw = 0x14,
): PreparedAssetPayload {
	const sourceBytes =
		formatRaw === 0xf4 ? new Uint8Array([255]) : new Uint8Array([255, 255, 255]);
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
