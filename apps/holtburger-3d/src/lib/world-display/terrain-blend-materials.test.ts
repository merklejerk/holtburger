import { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetPayload,
	type PreparedAssetRecord,
} from "../assets/types";
import { WorldMaterialResourceCache } from "./material-resources";
import { buildTerrainBlendMaterialSet } from "./terrain-blend-materials";

describe("buildTerrainBlendMaterialSet", () => {
	it("creates grouped shader materials for pcode-selected terrain textures", () => {
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = indexByAssetId([
			createRecord("terrain-material/1", createTerrainMaterialPayload()),
			createRecord(
				"surface-texture/05000010",
				createSurfaceTexturePayload(0x06000010),
			),
			createRecord(
				"render-surface/06000010",
				createRenderSurfacePayload(0x06000010),
			),
		]);
		const cache = new WorldMaterialResourceCache();

		const set = buildTerrainBlendMaterialSet({
			assetState: state,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 1])],
			materialResourceCache: cache,
		});

		expect(set?.materials).toHaveLength(1);
		expect(
			set?.materialIndexByPcode.get(terrainPcode([0, 0, 0, 0], [1, 1, 1, 1])),
		).toBe(0);
		const material = set?.materials[0];
		expect(material).toBeInstanceOf(ShaderMaterial);
		expect((material as ShaderMaterial).uniforms.baseTiling.value).toBe(4);
		expect((material as ShaderMaterial).uniforms.overlayCount.value).toBe(0);
		expect(cache.getStats().textureSamplingPolicySamples).toContain(
			"wrap=repeat/repeat;filter=linear/linear/linear;color=srgb;aniso=1;mips=on;flipY=off",
		);
	});

	it("samples terrain alpha masks as linear grayscale data", () => {
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = indexByAssetId([
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
		const cache = new WorldMaterialResourceCache();

		const set = buildTerrainBlendMaterialSet({
			assetState: state,
			regionNumber: 1,
			pcodes: [terrainPcode([0, 0, 0, 0], [1, 1, 1, 2])],
			materialResourceCache: cache,
		});

		const material = set?.materials[0] as ShaderMaterial;
		expect(material.uniforms.overlayCount.value).toBe(1);
		expect(material.fragmentShader).toContain(
			"texture2D(alphaTexture, rotateLegacyAlphaUv(legacyAlphaUv(vUv), rotation)).r",
		);
		expect(cache.getStats().textureSamplingPolicySamples).toContain(
			"wrap=clamp/clamp;filter=linear/linear/linear;color=none;aniso=1;mips=on;flipY=off",
		);
		cache.dispose();
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

function createTerrainMaterialPayload(
	includeOverlay = false,
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
				detail: null,
				colorVariation: null,
			},
			...(includeOverlay
				? [
						{
							terrainType: 2,
							textureAssetId: "surface-texture/05000011",
							textureDid: 0x05000011,
							tiling: 4,
							detail: null,
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
