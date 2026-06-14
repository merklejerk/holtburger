import { describe, expect, it } from "vitest";
import type {
	LandblockOutdoorPayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../../lib/host/contracts";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../assets/keys";
import type { StaticResolverJob } from "../contracts";
import { TerrainStaticScopeResolver } from "./terrain-resolver";

describe("V2 terrain static resolver", () => {
	it("resolves a concrete landblock terrain request into typed source facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("terrain-material", 1),
				createTerrainMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(0x05000010, 0x06000010),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000011),
				createSurfaceTexturePayload(0x05000011, 0x06000011),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000012),
				createSurfaceTexturePayload(0x05000012, 0x06000012),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(0x06000010, 0x04000010),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000011),
				createRenderSurfacePayload(0x06000011, null),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000012),
				createRenderSurfacePayload(0x06000012, null),
			),
			createPreparedAsset(
				createHostAssetKey("palette", 0x04000010),
				createPalettePayload(0x04000010),
			),
		]);

		const payload = await new TerrainStaticScopeResolver({
			assetService,
		}).resolve(createTerrainRequest());

		expect(payload.scope.kind).toBe("terrain");
		if (payload.scope.kind !== "terrain") {
			throw new Error("expected terrain payload");
		}

		expect(payload.scope.landblock).toEqual({
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		});
		expect(payload.scope.mesh).toMatchObject({
			bounds: {
				max: { x: 24, y: 3, z: 0 },
				min: { x: 0, y: 0, z: -24 },
			},
			gridSize: 2,
			quadCount: 1,
			tileSize: 24,
			triangleCount: 2,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 24, y: 1, z: 0 },
				{ x: 0, y: 2, z: -24 },
				{ x: 24, y: 3, z: -24 },
			],
			vertexCount: 4,
		});
		expect(payload.scope.mesh.quads[0]?.bounds).toEqual({
			max: { x: 24, y: 3, z: 0 },
			min: { x: 0, y: 0, z: -24 },
		});
		expect(payload.scope.sourceSpatial).toMatchObject({
			bounds: {
				max: { x: 24, y: 3, z: 0 },
				min: { x: 0, y: 0, z: -24 },
			},
			coordinateSpace: "landblock-render-local",
			terrainBvh: {
				coordinateSpace: "landblock-render-local",
				items: [{ quadIndex: 0 }],
				nodes: [
					{
						bounds: {
							max: { x: 24, y: 3, z: 0 },
							min: { x: 0, y: 0, z: -24 },
						},
					},
				],
			},
		});
		expect(payload.scope.terrainMaterial.identity).toEqual({
			kind: "terrain-material",
			regionNumber: 1,
		});
		expect(payload.scope.textureUses).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					preparedTextureUse: expect.objectContaining({
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
						usage: "rgba-color",
					}),
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "terrain-base",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				}),
				expect.objectContaining({
					preparedTextureUse: expect.objectContaining({
						kind: "prepared-render-surface-texture-use",
						usage: "rgba-mask",
					}),
					role: "terrain-alpha",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000011,
					},
				}),
			]),
		);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("does not use host asset route strings as resolver payload identity", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("terrain-material", 1),
				createTerrainMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(0x05000010, 0x06000010),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000011),
				createSurfaceTexturePayload(0x05000011, 0x06000011),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000012),
				createSurfaceTexturePayload(0x05000012, 0x06000012),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(0x06000010, null),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000011),
				createRenderSurfacePayload(0x06000011, null),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000012),
				createRenderSurfacePayload(0x06000012, null),
			),
		]);

		const payload = await new TerrainStaticScopeResolver({
			assetService,
		}).resolve(createTerrainRequest());
		const serializedScope = JSON.stringify(payload.scope);

		expect(serializedScope).not.toContain("surface-texture/");
		expect(serializedScope).not.toContain("render-surface/");
		expect(serializedScope).not.toContain("terrain-material/");
		expect(serializedScope).not.toContain("palette/");
		expect(serializedScope).not.toContain("landblock/");
	});

	it("reports missing dependency refs as typed identities", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("terrain-material", 1),
				createTerrainMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(0x05000010, 0x06000010),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000011),
				createSurfaceTexturePayload(0x05000011, 0x06000011),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000012),
				createSurfaceTexturePayload(0x05000012, 0x06000012),
			),
		]);

		const payload = await new TerrainStaticScopeResolver({
			assetService,
		}).resolve(createTerrainRequest());

		expect(payload.scope.kind).toBe("terrain");
		if (payload.scope.kind !== "terrain") {
			throw new Error("expected terrain payload");
		}

		expect(payload.scope.missingRefs).toEqual(
			expect.arrayContaining([
				{ kind: "render-surface", renderSurfaceId: 0x06000010 },
				{ kind: "render-surface", renderSurfaceId: 0x06000011 },
				{ kind: "render-surface", renderSurfaceId: 0x06000012 },
			]),
		);
	});
});

class FixtureAssetService implements AssetService {
	readonly #assets = new Map<string, PreparedAsset>();

	constructor(assets: readonly PreparedAsset[]) {
		for (const asset of assets) {
			this.#assets.set(describeHostAssetKey(asset.key), asset);
		}
	}

	async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const asset = this.#assets.get(describeHostAssetKey(key));
		if (!asset) {
			throw new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`);
		}

		return asset;
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		throw new Error(
			`FixtureAssetService does not support leases for ${describeHostAssetKey(
				key,
			)}.`,
		);
	}

	pruneExpiredWarmAssets(): void {}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			failures: [],
			pending: [],
		};
	}
}

function createPreparedAsset(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-10T00:00:00.000Z",
		revision: 1,
		sourceAssetId: describeHostAssetKey(key),
	};
}

function createTerrainRequest(): StaticResolverJob {
	return {
		domain: "outdoor-terrain",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createLandblockOutdoorPayload(): LandblockOutdoorPayloadDto {
	return {
		classification: "outdoor",
		diagnostics: { errors: [], omissions: [], sourceRecords: [] },
		kind: "landblock-outdoor",
		landblockId: 0xda55ffff,
		outdoorBvh: null,
		provenance: createProvenance("landblock-outdoor"),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "outdoor-landblock",
		sourceAssetKind: "landblock-outdoor",
		statics: [],
		terrain: {
			bounds: {
				max: { x: 24, y: 24, z: 3 },
				min: { x: 0, y: 0, z: 0 },
			},
			gridSize: 2,
			maxHeight: 3,
			minHeight: 0,
			quads: [
				{
					averageHeight: 1,
					bounds: {
						max: { x: 24, y: 24, z: 3 },
						min: { x: 0, y: 0, z: 0 },
					},
					col: 0,
					cornerTerrainCodes: [1, 1, 1, 1],
					diagonal: "southwest-northeast",
					pcode: 1,
					quadIndex: 0,
					row: 0,
					sourceTerrainIndices: [0, 1, 2, 3],
					terrainQuadId: "q0",
					triangleIndices: [0, 1],
					vertexIndices: [0, 1, 2, 3],
				},
			],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				items: [
					{
						col: 0,
						quadIndex: 0,
						row: 0,
						triangleIndices: [0, 1],
					},
				],
				nodes: [
					{
						bounds: {
							max: { x: 24, y: 24, z: 3 },
							min: { x: 0, y: 0, z: 0 },
						},
						itemIndices: [0],
						kindMask: {
							domain: "outdoor-terrain",
							terrainQuad: true,
						},
						left: null,
						right: null,
					},
				],
			},
			tileSize: 24,
			triangles: [
				createTerrainTriangle("t0", 0),
				createTerrainTriangle("t1", 1),
			],
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 24, y: 0, z: 1 },
				{ x: 0, y: 24, z: 2 },
				{ x: 24, y: 24, z: 3 },
			],
		},
	};
}

function createTerrainTriangle(
	terrainTriangleId: string,
	triangleInQuad: 0 | 1,
): LandblockOutdoorPayloadDto["terrain"]["triangles"][number] {
	return {
		averageHeight: 1,
		bounds: {
			max: { x: 24, y: 24, z: 3 },
			min: { x: 0, y: 0, z: 0 },
		},
		quadIndex: 0,
		terrainTriangleId,
		triangleInQuad,
		vertexIndices: [0, 1, 2],
	};
}

function createTerrainMaterialPayload(): TerrainMaterialPayloadDto {
	return {
		dependencies: {
			paletteAssetIds: ["palette/04000010"],
			renderSurfaceAssetIds: ["render-surface/06000010"],
			surfaceTextureAssetIds: [
				"surface-texture/05000010",
				"surface-texture/05000011",
				"surface-texture/05000012",
			],
		},
		kind: "terrain-material",
		materialKind: "tex-merge-table",
		pcodeEncoding: {
			roadCodeBits: 2,
			sizeBitMask: 0xff,
			terrainCodeBits: 5,
		},
		provenance: createProvenance("terrain-material"),
		regionNumber: 1,
		residencyKind: "unknown",
		roadAlphaMaps: [],
		sourceAssetKind: "terrain-material",
		terrainAlphaMaps: [
			{
				alphaIndex: 0,
				alphaTextureAssetId: "surface-texture/05000011",
				alphaTextureDid: 0x05000011,
				selector: 1,
			},
		],
		terrainTypes: [
			{
				colorVariation: null,
				terrainType: 1,
				textureAssetId: "surface-texture/05000010",
				textureDid: 0x05000010,
				tiling: 1,
			},
		],
	};
}

function createRegionRenderProfilePayload(): RegionRenderProfilePayloadDto {
	const detailRole = {
		fadeFar: 256,
		fadeNear: 128,
		role: "landscape" as const,
		sourceTerrainDescIndex: 0,
		textureAssetId: "surface-texture/05000012",
		textureDid: 0x05000012,
		tiling: 4,
	};

	return {
		dependencies: {
			paletteAssetIds: [],
			renderSurfaceAssetIds: ["render-surface/06000012"],
			surfaceTextureAssetIds: ["surface-texture/05000012"],
		},
		detailRoles: {
			building: null,
			environment: null,
			landscape: detailRole,
			object: null,
		},
		kind: "region-render-profile",
		provenance: createProvenance("region-render-profile"),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "unknown",
		sourceAssetKind: "region-render-profile",
	};
}

function createSurfaceTexturePayload(
	surfaceTextureId: number,
	renderSurfaceId: number,
): SurfaceTexturePayloadDto {
	return {
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		kind: "surface-texture",
		provenance: createProvenance("surface-texture"),
		renderSurfaceIds: [renderSurfaceId],
		residencyKind: "unknown",
		selectedRenderSurfaceId: renderSurfaceId,
		sourceAssetKind: "surface-texture",
		surfaceTextureId,
		textureType: 0,
		unknown: 0,
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	defaultPaletteId: number | null,
): RenderSurfacePayloadDto {
	return {
		defaultPaletteId,
		dependencies: {
			paletteAssetIds:
				defaultPaletteId === null
					? []
					: [`palette/${defaultPaletteId.toString(16).padStart(8, "0")}`],
		},
		format: "bgra8",
		formatRaw: 1,
		height: 2,
		kind: "render-surface",
		provenance: createProvenance("render-surface"),
		renderSurfaceId,
		residencyKind: "unknown",
		sourceAssetKind: "render-surface",
		sourceByteLength: 16,
		sourceBytes: new Uint8Array(16),
		unknown: 0,
		width: 2,
	};
}

function createPalettePayload(paletteId: number): PalettePayloadDto {
	return {
		colorCount: 1,
		colorsArgb: Uint32Array.from([0xff000000]),
		kind: "palette",
		paletteId,
		provenance: createProvenance("palette"),
		residencyKind: "unknown",
		sourceAssetKind: "palette",
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "app-local-stub",
		sourceAssetKind,
	};
}
