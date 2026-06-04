import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedAssetPayload,
	type PreparedAssetRecord,
	type PreparedLandblockOutdoorPayload,
} from "../assets/types";
import { formatLandblockOutdoorAssetId } from "../landblocks";
import { buildLandblockTerrainRenderArtifact } from "./terrain-render-artifact";

describe("terrain render artifact", () => {
	it("builds first-class terrain artifacts with blend draw slices and page refs", () => {
		const landblockId = 0xda55ffff;
		const outdoor = createOutdoorPayload(landblockId);
		const artifact = buildLandblockTerrainRenderArtifact({
			assetState: createAssetState([
				createRecord(formatLandblockOutdoorAssetId(landblockId), outdoor),
				createRecord("terrain-material/1", createTerrainMaterialPayload()),
				createRecord(
					"surface-texture/05000010",
					createSurfaceTexturePayload(0x06000010),
				),
				createRecord(
					"render-surface/06000010",
					createRenderSurfacePayload(0x06000010),
				),
				createRecord(
					formatAtlasReadyPreparedTextureAssetId({
						renderSurfaceId: 0x06000010,
						usage: "raw",
					}),
					createPreparedTexturePayload(0x06000010),
				),
			]),
			outdoor,
			policy: createPolicy(),
			requestId: "request:terrain",
		});

		expect(artifact.type).toBe("landblock-terrain-render-artifact");
		expect(artifact.landblockId).toBe(landblockId);
		expect(artifact.diagnostics.status).toBe("ready");
		expect(artifact.mesh.triangles).toHaveLength(2);
		expect(artifact.drawSlices).toHaveLength(1);
		expect(artifact.drawSlices[0]?.geometry.triangleCount).toBe(2);
		expect(
			artifact.texturePageRefs.map((ref) => [ref.role, ref.sourceAssetId]),
		).toEqual([
			[
				"color",
				"prepared-texture/06000010?usage=raw&out=rgba8&mips=none&cs=linear",
			],
		]);
		expect(artifact.bvhItemKeys).toEqual(["terrain:landblock:da55ffff:quad:0"]);
		expect(artifact.diagnosticRootAssetIds).toEqual([
			formatLandblockOutdoorAssetId(landblockId),
		]);
		expect(artifact.diagnosticPreparedAssetIds).toContain("terrain-material/1");
		expect(artifact.diagnosticPreparedAssetIds).toContain(
			"render-surface/06000010",
		);
		expect(artifact.diagnosticPreparedAssetIds).toContain(
			"prepared-texture/06000010?usage=raw&out=rgba8&mips=none&cs=linear",
		);
	});

	it("keeps terrain resident as its own artifact when material resources are incomplete", () => {
		const landblockId = 0xda55ffff;
		const outdoor = createOutdoorPayload(landblockId);
		const artifact = buildLandblockTerrainRenderArtifact({
			assetState: createAssetState([
				createRecord(formatLandblockOutdoorAssetId(landblockId), outdoor),
			]),
			outdoor,
			policy: createPolicy(),
			requestId: "request:terrain",
		});

		expect(artifact.type).toBe("landblock-terrain-render-artifact");
		expect(artifact.drawSlices).toEqual([]);
		expect(artifact.debugFallbackGeometry.triangleCount).toBe(2);
		expect(artifact.texturePageRefs).toEqual([]);
		expect(artifact.diagnostics.status).toBe("debug-fallback");
		expect(artifact.diagnostics.fallbackReasons).toEqual([
			"terrain material resources missing-table",
			"missing terrain blend plan set",
			"no terrain draw slices",
		]);
	});
});

function createPolicy() {
	return {
		buildPolicyRevision: "terrain-build:v1",
		cpuTexturePagePolicyRevision: "terrain-pages:v1",
		maxLayerEntries: 8,
	};
}

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
		preparedAt: "2026-06-04T00:00:00.000Z",
	};
}

function createOutdoorPayload(
	landblockId: number,
): PreparedLandblockOutdoorPayload {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 16, y: 16, z: 0 },
	};
	return {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("landblock-outdoor"),
		landblockId,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
			gridSize: 2,
			tileSize: 16,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 16, y: 0, z: 0 },
				{ x: 0, y: 16, z: 0 },
				{ x: 16, y: 16, z: 0 },
			],
			triangles: [
				{
					terrainTriangleId: "terrain/tri/0",
					quadIndex: 0,
					triangleInQuad: 0,
					vertexIndices: [0, 1, 2],
					averageHeight: 0,
					bounds,
				},
				{
					terrainTriangleId: "terrain/tri/1",
					quadIndex: 0,
					triangleInQuad: 1,
					vertexIndices: [2, 1, 3],
					averageHeight: 0,
					bounds,
				},
			],
			quads: [
				{
					terrainQuadId: "terrain/quad/0",
					row: 0,
					col: 0,
					quadIndex: 0,
					sourceTerrainIndices: [0, 1, 2, 3],
					vertexIndices: [0, 1, 2, 3],
					triangleIndices: [0, 1],
					diagonal: "southwest-northeast",
					cornerTerrainCodes: [1, 1, 1, 1],
					pcode: terrainPcode([0, 0, 0, 0], [1, 1, 1, 1]),
					averageHeight: 0,
					bounds,
				},
			],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [{ row: 0, col: 0, quadIndex: 0, triangleIndices: [0, 1] }],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds,
		},
		statics: [],
		outdoorBvh: null,
		dependencies: {
			renderableSourceAssetIds: [],
			materialAssetIds: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
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
		terrainAlphaMaps: [],
		roadAlphaMaps: [],
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

function createSurfaceTexturePayload(
	renderSurfaceId: number,
): PreparedAssetPayload {
	return {
		kind: "surface-texture",
		sourceAssetKind: "surface-texture",
		residencyKind: "unknown",
		provenance: createProvenance("surface-texture"),
		surfaceTextureId: 0x05000010,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId: renderSurfaceId,
		renderSurfaceIds: [renderSurfaceId],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
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
		formatRaw: 0x15,
		format: "A8R8G8B8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 255, 255, 255]),
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	};
}

function createPreparedTexturePayload(
	renderSurfaceId: number,
): PreparedAssetPayload {
	return {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: createProvenance("prepared-texture"),
		renderSurfaceId,
		usage: "raw",
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: 0x15,
		sourceFormat: "A8R8G8B8",
		sourceWidth: 1,
		sourceHeight: 1,
		sourceByteLength: 4,
		sourceHash: "prepared-texture-test",
		levels: [
			{
				level: 0,
				width: 1,
				height: 1,
				formatRaw: 0x15,
				format: "rgba8",
				byteLength: 4,
				bytes: new Uint8Array([255, 255, 255, 255]),
			},
		],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: 4,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
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

function terrainPcode(
	roadCodes: readonly [number, number, number, number],
	terrainCodes: readonly [number, number, number, number],
): number {
	return (
		((roadCodes[0] & 0x3) << 26) |
		((roadCodes[1] & 0x3) << 24) |
		((roadCodes[2] & 0x3) << 22) |
		((roadCodes[3] & 0x3) << 20) |
		((terrainCodes[0] & 0x1f) << 15) |
		((terrainCodes[1] & 0x1f) << 10) |
		((terrainCodes[2] & 0x1f) << 5) |
		(terrainCodes[3] & 0x1f)
	);
}
